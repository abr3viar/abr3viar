import "server-only";
import { and, desc, eq, gt } from "drizzle-orm";
import { isStripeLiveMode } from "@/env";
import { cutLightSessionAccess, getOwnedConversation } from "@/server/access";
import { recordAccess } from "@/server/access-log";
import type { Viewer } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { funnelEvents, purchases, reportTypes, reports, type Report, type ReportType } from "@/server/db/schema";
import { getClientIp } from "@/server/http";
import { log } from "@/server/log";
import { consumeRateLimit } from "@/server/rate-limit";
import { paymentLinkFor } from "@/server/reports/get-report-view";
import { MAIN_REPORT_SLUG, SUBSCRIPTION_SLUG } from "@/server/reports/catalog";
import { SUBSCRIPTION_DAILY_LIMIT } from "@/lib/subscription";
import { findActiveSubscription, findOpenSubscription, usedToday } from "./subscriptions";

export type CheckoutResult =
  | { ok: true; url: string }
  | {
      ok: false;
      redirectTo?: string;
      error: "not_found" | "not_ready" | "unavailable" | "rate_limited" | "main_required" | "needs_user_side" | "login_required" | "overage_not_allowed";
    };

const PENDING_REUSE_MS = 24 * 3_600_000;
/** Compra além do limite (vale 24 h no webhook): só reaproveita a de até 1 h (D96). */
const OVERAGE_REUSE_MS = 3_600_000;

/** URL final do Payment Link com `client_reference_id` = id da purchase (D10). */
export function buildPaymentUrl(linkUrl: string, purchaseId: string, email: string): string {
  const url = new URL(linkUrl);
  url.searchParams.set("client_reference_id", purchaseId);
  url.searchParams.set("prefilled_email", email);
  url.searchParams.set("locale", "pt-BR");
  return url.toString();
}

async function createOrReusePurchase(viewer: Viewer, report: Report, rt: ReportType): Promise<string> {
  const db = getDb();
  const live = isStripeLiveMode();
  const [pending] = await db
    .select()
    .from(purchases)
    .where(
      and(
        eq(purchases.reportId, report.id),
        eq(purchases.reportTypeId, rt.id),
        eq(purchases.userId, viewer.userId),
        eq(purchases.status, "pending"),
        eq(purchases.livemode, live),
        eq(purchases.amountCents, rt.priceCents),
        gt(purchases.createdAt, new Date(Date.now() - (rt.kind === "overage" ? OVERAGE_REUSE_MS : PENDING_REUSE_MS))),
      ),
    )
    .orderBy(desc(purchases.createdAt));
  if (pending) {
    // Reaproveitada: vira a compra "mais recente" para a página de retorno (QA-05).
    await db.update(purchases).set({ updatedAt: new Date() }).where(eq(purchases.id, pending.id));
    return pending.id;
  }
  const [created] = await db
    .insert(purchases)
    .values({
      userId: viewer.userId,
      reportId: report.id,
      reportTypeId: rt.id,
      amountCents: rt.priceCents,
      currency: rt.currency,
      livemode: live,
    })
    .returning({ id: purchases.id });
  return created!.id;
}

/**
 * Inicia a compra (plano.md 6.2): confere dono, pré-requisitos e rate limit, cria (ou
 * reaproveita) a purchase pendente e devolve a URL do Payment Link. NÃO libera nada.
 */
export async function startCheckout(viewer: Viewer, conversationId: string, slug: string): Promise<CheckoutResult> {
  const conv = await getOwnedConversation(conversationId, viewer);
  if (!conv) return { ok: false, error: "not_found" };
  const db = getDb();
  const [rt] = await db.select().from(reportTypes).where(and(eq(reportTypes.slug, slug), eq(reportTypes.isActive, true)));
  // A assinatura não é comprada por aqui (startSubscriptionCheckout).
  if (!rt || rt.kind === "subscription") return { ok: false, error: "not_found" };

  const [main] = await db
    .select({ report: reports })
    .from(reports)
    .innerJoin(reportTypes, eq(reportTypes.id, reports.reportTypeId))
    .where(and(eq(reports.conversationId, conv.id), eq(reportTypes.slug, MAIN_REPORT_SLUG)));
  if (!main || main.report.status !== "ready") return { ok: false, error: "not_ready" };

  let report: Report;
  if (rt.kind === "main" || rt.kind === "overage") {
    report = main.report;
    if (report.isUnlocked) return { ok: false, error: "not_ready", redirectTo: `/r/${conv.id}` };
    if (rt.kind === "overage") {
      // Só para assinante (sessão verificada) que já usou o limite do dia (D96).
      if (!viewer.verified) return { ok: false, error: "login_required" };
      const sub = await findActiveSubscription(db, viewer.userId);
      if (!sub || (await usedToday(db, viewer.userId)) < SUBSCRIPTION_DAILY_LIMIT) return { ok: false, error: "overage_not_allowed" };
    }
  } else {
    if (!main.report.isUnlocked) return { ok: false, error: "main_required", redirectTo: `/r/${conv.id}` };
    if (rt.requiresUserSide && conv.userIs === "none") return { ok: false, error: "needs_user_side" };
    const [existing] = await db
      .select()
      .from(reports)
      .where(and(eq(reports.conversationId, conv.id), eq(reports.reportTypeId, rt.id)));
    if (existing?.isUnlocked) return { ok: false, error: "not_ready", redirectTo: `/r/${conv.id}/extra/${rt.slug}` };
    report =
      existing ??
      (
        await db
          .insert(reports)
          .values({ conversationId: conv.id, reportTypeId: rt.id, status: "pending_payment" })
          .onConflictDoUpdate({ target: [reports.conversationId, reports.reportTypeId], set: { updatedAt: new Date() } })
          .returning()
      )[0]!;
  }

  const link = paymentLinkFor(rt);
  if (!link) return { ok: false, error: "unavailable" };

  const ip = await getClientIp();
  if (!(await consumeRateLimit("checkout", [`user:${viewer.userId}`, `ip:${ip}`]))) {
    return { ok: false, error: "rate_limited" };
  }

  // S-03: comprando logado, a sessão leve de outro aparelho que fez o envio perde o acesso.
  await cutLightSessionAccess(viewer, conv);
  const purchaseId = await createOrReusePurchase(viewer, report, rt);
  await db.insert(funnelEvents).values({ event: "checkout_started", reportTypeSlug: rt.slug });
  await recordAccess("checkout", viewer.userId);
  log.info({ purchaseId, reportId: report.id, kind: rt.kind }, "checkout_started");
  return { ok: true, url: buildPaymentUrl(link.url, purchaseId, viewer.email) };
}

export type SubscriptionCheckoutResult =
  | { ok: true; url: string }
  | { ok: false; error: "login_required" | "already_subscribed" | "subscription_pending" | "unavailable" | "rate_limited" };

/**
 * Inicia a assinatura mensal (D96). Exige sessão VERIFICADA pelo link do e-mail: a assinatura
 * fica ligada à conta do e-mail confirmado. NÃO ativa nada: quem ativa é o webhook.
 */
export async function startSubscriptionCheckout(viewer: Viewer): Promise<SubscriptionCheckoutResult> {
  if (!viewer.verified) return { ok: false, error: "login_required" };
  const db = getDb();
  if (await findActiveSubscription(db, viewer.userId)) return { ok: false, error: "already_subscribed" };
  // Assinatura ainda aberta no Stripe (cobrança pendente, ou sendo encerrada): assinar de novo cobraria em dobro.
  if (await findOpenSubscription(db, viewer.userId)) return { ok: false, error: "subscription_pending" };
  const [rt] = await db
    .select()
    .from(reportTypes)
    .where(and(eq(reportTypes.slug, SUBSCRIPTION_SLUG), eq(reportTypes.kind, "subscription"), eq(reportTypes.isActive, true)));
  const link = rt ? paymentLinkFor(rt) : null;
  if (!rt || !link) return { ok: false, error: "unavailable" };
  const ip = await getClientIp();
  if (!(await consumeRateLimit("checkout", [`user:${viewer.userId}`, `ip:${ip}`]))) return { ok: false, error: "rate_limited" };

  const live = isStripeLiveMode();
  const [pending] = await db
    .select({ id: purchases.id })
    .from(purchases)
    .where(
      and(
        eq(purchases.userId, viewer.userId),
        eq(purchases.reportTypeId, rt.id),
        eq(purchases.status, "pending"),
        eq(purchases.livemode, live),
        eq(purchases.amountCents, rt.priceCents),
        gt(purchases.createdAt, new Date(Date.now() - PENDING_REUSE_MS)),
      ),
    )
    .orderBy(desc(purchases.createdAt));
  let purchaseId = pending?.id;
  if (purchaseId) {
    await db.update(purchases).set({ updatedAt: new Date() }).where(eq(purchases.id, purchaseId));
  } else {
    const [created] = await db
      .insert(purchases)
      .values({ userId: viewer.userId, reportTypeId: rt.id, amountCents: rt.priceCents, currency: rt.currency, livemode: live })
      .returning({ id: purchases.id });
    purchaseId = created!.id;
  }
  await db.insert(funnelEvents).values({ event: "checkout_started", reportTypeSlug: rt.slug });
  await recordAccess("checkout", viewer.userId);
  log.info({ purchaseId, kind: "subscription" }, "checkout_started");
  return { ok: true, url: buildPaymentUrl(link.url, purchaseId, viewer.email) };
}
