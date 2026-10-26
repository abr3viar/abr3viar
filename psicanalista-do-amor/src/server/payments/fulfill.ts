import "server-only";
import { and, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";
import type Stripe from "stripe";
import { isUuid } from "@/server/access";
import { getDb, type Tx } from "@/server/db/client";
import {
  auditLog,
  conversations,
  funnelEvents,
  purchases,
  reportTypes,
  reports,
  sessions,
  stripeEvents,
  subscriptionUnlocks,
  subscriptions,
} from "@/server/db/schema";
import { SUBSCRIPTION_DAILY_LIMIT } from "@/lib/subscription";
import { SUBSCRIPTION_SLUG } from "@/server/reports/catalog";
import { applySubscriptionState, FINAL_STATUSES, findActiveSubscription, todaySql, usedToday } from "./subscriptions";
import { enqueue } from "@/server/jobs/boss";
import { log } from "@/server/log";
import { sendAlert } from "@/server/alerts";
import { computeExpiresAt } from "@/server/retention";

/**
 * ÚNICO módulo que escreve `reports.is_unlocked` (CLAUDE.md, regra 2; plano.md 6.3 e 7.6).
 * Chamado pelo webhook do Stripe DEPOIS de validar a assinatura, e pela reconciliação
 * (que lê as sessões direto da API autenticada do Stripe).
 *
 * Tudo acontece numa transação: registro do evento (idempotência), conferências,
 * compra paga, liberação, job do relatório adicional, auditoria e e-mail.
 *
 * Assinatura mensal (D96): o webhook ativa a assinatura; a liberação pela assinatura
 * (`unlockWithSubscription`, `unlockExtraWithSubscription`) só acontece com uma assinatura
 * cujo estado veio do Stripe e dentro do limite diário, sempre por aqui.
 */

export type Outcome =
  | "unlocked"
  | "already_paid"
  | "duplicate_event"
  | "awaiting_async_payment"
  | "purchase_not_found"
  | "missing_client_reference_id"
  | "mismatch"
  | "duplicate_payment"
  | "marked_failed"
  | "marked_expired"
  | "revoked"
  | "partial_refund_ignored"
  | "subscription_activated"
  | "subscription_synced"
  | "ignored";

type Result = { outcome: Outcome; error?: string };

const LOCK = "update" as const;
/** A compra de relatório além do limite (D96) vale por 24 h depois de criada. */
const OVERAGE_PURCHASE_TTL_MS = 24 * 3_600_000;

/** Advisory lock da transação por PaymentIntent (liberação e revogação não se cruzam). */
async function lockPaymentIntent(tx: Tx, paymentIntentId: string): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`pi:${paymentIntentId}`}))`);
}

function idOf(value: string | { id: string } | null | undefined): string | null {
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
}

async function findPurchaseForSession(tx: Tx, session: Stripe.Checkout.Session) {
  const ref = session.client_reference_id;
  if (!ref || !isUuid(ref)) return { error: "missing_client_reference_id" as const };
  const [row] = await tx
    .select({ purchase: purchases, reportType: reportTypes })
    .from(purchases)
    .innerJoin(reportTypes, eq(reportTypes.id, purchases.reportTypeId))
    .where(eq(purchases.id, ref))
    .for("update", { of: purchases });
  if (!row) return { error: "purchase_not_found" as const };
  return { row };
}

type Found = Awaited<ReturnType<typeof findPurchaseForSession>>;
function foundError(found: Found): "missing_client_reference_id" | "purchase_not_found" | null {
  return "error" in found && found.error ? found.error : null;
}

/** Confere link, moeda, valor, modo e ambiente (D11). Retorna o código da divergência. */
export function checkSessionMatches(
  session: Pick<Stripe.Checkout.Session, "payment_link" | "currency" | "amount_total" | "mode" | "livemode">,
  purchase: { amountCents: number; currency: string; livemode: boolean },
  reportType: { kind: string; stripePaymentLinkId: string | null; stripeTestPaymentLinkId: string | null },
): string | null {
  const expectedLink = session.livemode ? reportType.stripePaymentLinkId : reportType.stripeTestPaymentLinkId;
  if (session.livemode !== purchase.livemode) return "mismatch_livemode";
  if (!expectedLink || idOf(session.payment_link) !== expectedLink) return "mismatch_payment_link";
  if ((session.currency ?? "").toLowerCase() !== purchase.currency.toLowerCase()) return "mismatch_currency";
  if (typeof session.amount_total !== "number" || session.amount_total < purchase.amountCents) return "mismatch_amount";
  // Assinatura só por sessão de assinatura; relatórios só por pagamento avulso.
  if (session.mode !== (reportType.kind === "subscription" ? "subscription" : "payment")) return "mismatch_mode";
  return null;
}

/** Sessão de assinatura que não vai virar acesso (sem compra, sem dono, duplicada): cancela no Stripe. */
async function cancelOrphanSubscription(tx: Tx, session: Stripe.Checkout.Session, reason: string): Promise<void> {
  const stripeSubscriptionId = session.mode === "subscription" ? idOf(session.subscription) : null;
  if (!stripeSubscriptionId) return;
  // Só a assinatura DESTE site (Payment Link da assinatura no modo da sessão): outro produto
  // recorrente da mesma conta Stripe, ou outro ambiente, nunca é cancelado daqui (fica o alerta).
  const [rt] = await tx
    .select({ live: reportTypes.stripePaymentLinkId, test: reportTypes.stripeTestPaymentLinkId })
    .from(reportTypes)
    .where(and(eq(reportTypes.slug, SUBSCRIPTION_SLUG), eq(reportTypes.kind, "subscription")));
  const ourLink = session.livemode ? rt?.live : rt?.test;
  if (!ourLink || idOf(session.payment_link) !== ourLink) return;
  await enqueue("subscription_cancel", { stripeSubscriptionId, reason }, { tx, singletonKey: stripeSubscriptionId });
}

/** O alerta de cobrança em dobro desta sessão já foi registrado? (reenvio do Stripe/reconciliação) */
async function duplicateAlreadyRecorded(tx: Tx, sessionId: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: auditLog.id })
    .from(auditLog)
    .where(and(eq(auditLog.action, "payment.duplicate"), sql`${auditLog.meta}->>'sessionId' = ${sessionId}`))
    .limit(1);
  return Boolean(row);
}

/** Libera o relatório de uma Checkout Session paga (plano.md 6.3, passo 4). */
export async function unlockFromSession(tx: Tx, session: Stripe.Checkout.Session): Promise<Result> {
  // Ordem fixa dos locks (advisory do PaymentIntent → linha da compra), a mesma de
  // revokeByPaymentIntent: liberação e reembolso concorrentes não entram em deadlock.
  const paymentIntentId = idOf(session.payment_intent);
  if (paymentIntentId) await lockPaymentIntent(tx, paymentIntentId);
  const found = await findPurchaseForSession(tx, session);
  const notFound = foundError(found);
  if (notFound || !("row" in found) || !found.row) {
    const code = notFound ?? "purchase_not_found";
    log.error({ sessionId: session.id, code }, "stripe_reconcile_manually");
    await tx.insert(auditLog).values({ action: "payment.unmatched", targetId: session.id, meta: { code } });
    // Assinatura paga sem compra do site (link aberto direto): não fica cobrando todo mês.
    await cancelOrphanSubscription(tx, session, code);
    return { outcome: code, error: code };
  }
  const { purchase, reportType } = found.row;
  if (purchase.status === "paid") {
    if (purchase.stripeCheckoutSessionId && purchase.stripeCheckoutSessionId !== session.id) {
      // Mesma compra paga por DUAS sessões (ex.: abriu o Pix, pagou com cartão e o Pix
      // compensou depois): cliente cobrado em dobro → reembolso manual.
      log.error({ purchaseId: purchase.id, sessionId: session.id }, "stripe_duplicate_payment");
      await tx.insert(auditLog).values({
        userId: purchase.userId,
        action: "payment.duplicate",
        targetId: purchase.id,
        meta: { sessionId: session.id },
      });
      // Segunda assinatura pela mesma compra: cancela a duplicada (a primeira continua).
      await cancelOrphanSubscription(tx, session, "duplicate_payment");
      return { outcome: "duplicate_payment", error: "duplicate_payment" };
    }
    return { outcome: "already_paid" };
  }
  // Reembolso/contestação que chegou ANTES da liberação (webhook de pagamento perdido):
  // nunca libera depois, nem pelo reenvio do Stripe nem pela reconciliação.
  const [revokedEarly] = paymentIntentId
    ? await tx
        .select({ meta: auditLog.meta })
        .from(auditLog)
        .where(and(eq(auditLog.action, "payment.revoked_unmatched"), eq(auditLog.targetId, paymentIntentId)))
        .limit(1)
    : [];
  if (purchase.status === "refunded" || purchase.status === "disputed" || revokedEarly) {
    if (revokedEarly && purchase.status !== "refunded" && purchase.status !== "disputed") {
      const status = revokedEarly.meta?.status === "disputed" ? "disputed" : "refunded";
      await tx.update(purchases).set({ status, stripeCheckoutSessionId: session.id, stripePaymentIntentId: paymentIntentId }).where(eq(purchases.id, purchase.id));
    }
    log.warn({ purchaseId: purchase.id, sessionId: session.id }, "stripe_unlock_after_refund_blocked");
    return { outcome: "revoked", error: "refunded_before_unlock" };
  }

  const mismatch = checkSessionMatches(session, purchase, reportType);
  if (mismatch) {
    log.error({ purchaseId: purchase.id, sessionId: session.id, code: mismatch }, "stripe_payment_mismatch");
    await tx.insert(auditLog).values({
      userId: purchase.userId,
      action: "payment.mismatch",
      targetId: purchase.id,
      meta: { code: mismatch, sessionId: session.id },
    });
    return { outcome: "mismatch", error: mismatch };
  }
  if (reportType.kind === "subscription") return activateSubscription(tx, session, purchase, reportType.slug);
  // Valor de assinante sem cota no dia (D96): vale só para a compra recente (24 h), não como vale eterno.
  if (
    reportType.kind === "overage" &&
    purchase.createdAt.getTime() < Date.now() - OVERAGE_PURCHASE_TTL_MS &&
    // Quem continua assinante pagou o valor de assinante legitimamente: libera.
    !(purchase.userId && (await findActiveSubscription(tx, purchase.userId)))
  ) {
    log.error({ purchaseId: purchase.id, sessionId: session.id, code: "overage_expired" }, "stripe_payment_mismatch");
    await tx.insert(auditLog).values({ userId: purchase.userId, action: "payment.mismatch", targetId: purchase.id, meta: { code: "overage_expired", sessionId: session.id } });
    return { outcome: "mismatch", error: "overage_expired" };
  }
  if (!purchase.reportId) return { outcome: "purchase_not_found", error: "report_deleted" };

  const [report] = await tx.select().from(reports).where(eq(reports.id, purchase.reportId)).for(LOCK);
  if (!report) return { outcome: "purchase_not_found", error: "report_deleted" };

  // Outra compra já pagou este relatório (pagamento em dobro): não libera de novo; reembolso manual.
  const [otherPaid] = await tx
    .select({ id: purchases.id })
    .from(purchases)
    .where(and(eq(purchases.reportId, report.id), eq(purchases.status, "paid"), ne(purchases.id, purchase.id)));
  if (otherPaid) {
    // Já registrado antes (reenvio do Stripe ou reconciliação): não repete audit nem alerta.
    // (Pelo audit, não pelo session_id da compra: o Pix pendente já grava o mesmo session_id.)
    if (await duplicateAlreadyRecorded(tx, session.id)) return { outcome: "duplicate_payment" };
    await tx.update(purchases).set({ stripeCheckoutSessionId: session.id, stripePaymentIntentId: idOf(session.payment_intent) }).where(eq(purchases.id, purchase.id));
    log.error({ purchaseId: purchase.id, reportId: report.id }, "stripe_duplicate_payment");
    await tx.insert(auditLog).values({
      userId: purchase.userId,
      action: "payment.duplicate",
      targetId: purchase.id,
      meta: { sessionId: session.id },
    });
    return { outcome: "duplicate_payment", error: "duplicate_payment" };
  }
  // Já liberado por outro caminho (ex.: pela assinatura, D96) e pago de novo por um link
  // pendente: não marca como paga; reembolso manual (alerta).
  if (report.isUnlocked) {
    if (await duplicateAlreadyRecorded(tx, session.id)) return { outcome: "duplicate_payment" };
    await tx.update(purchases).set({ stripeCheckoutSessionId: session.id, stripePaymentIntentId: idOf(session.payment_intent) }).where(eq(purchases.id, purchase.id));
    log.error({ purchaseId: purchase.id, reportId: report.id }, "stripe_duplicate_payment");
    await tx.insert(auditLog).values({ userId: purchase.userId, action: "payment.duplicate", targetId: purchase.id, meta: { sessionId: session.id, reason: "already_unlocked" } });
    return { outcome: "duplicate_payment", error: "duplicate_payment" };
  }

  const now = new Date();
  await tx
    .update(purchases)
    .set({
      status: "paid",
      paidAt: now,
      stripeCheckoutSessionId: session.id,
      stripePaymentIntentId: idOf(session.payment_intent),
      paymentMethodType: session.payment_method_types?.length === 1 ? session.payment_method_types[0]! : null,
      amountPaidCents: session.amount_total,
    })
    .where(eq(purchases.id, purchase.id));

  const isExtraToGenerate = reportType.kind === "extra" && report.status === "pending_payment";
  await tx
    .update(reports)
    .set({
      isUnlocked: true,
      unlockedAt: now,
      ...(isExtraToGenerate ? { status: "queued" as const, progress: { step: "queued" } } : {}),
    })
    .where(eq(reports.id, report.id));

  if (isExtraToGenerate) {
    await enqueue("generate_extra", { reportId: report.id }, { tx, singletonKey: report.id });
  } else if (reportType.kind === "main" || reportType.kind === "overage") {
    // "overage" = relatório principal do assinante além do limite do dia (D96).
    await enqueue("send_email", { template: "report_unlocked", reportId: report.id }, { tx, singletonKey: `report_unlocked:${report.id}` });
  }
  await tx
    .update(conversations)
    .set({ expiresAt: computeExpiresAt(true), lastAccessedAt: now })
    .where(eq(conversations.id, report.conversationId));
  await tx.insert(auditLog).values({
    userId: purchase.userId,
    action: "report.unlocked",
    targetId: report.id,
    meta: { purchaseId: purchase.id, sessionId: session.id, kind: reportType.kind },
  });
  await tx.insert(funnelEvents).values({ event: "payment_confirmed", reportTypeSlug: reportType.slug });
  log.info({ purchaseId: purchase.id, reportId: report.id, kind: reportType.kind }, "report_unlocked");
  return { outcome: "unlocked" };
}

/** Checkout de assinatura pago: liga a assinatura do Stripe à conta da compra (D96). */
async function activateSubscription(
  tx: Tx,
  session: Stripe.Checkout.Session,
  purchase: typeof purchases.$inferSelect,
  slug: string,
): Promise<Result> {
  const stripeSubscriptionId = idOf(session.subscription);
  if (!stripeSubscriptionId) return { outcome: "mismatch", error: "missing_subscription" };
  if (!purchase.userId) {
    // Conta excluída entre o checkout e a confirmação: cancela no Stripe; reembolso manual (alerta).
    log.error({ purchaseId: purchase.id, sessionId: session.id }, "subscription_without_user");
    await enqueue("subscription_cancel", { stripeSubscriptionId, reason: "user_deleted" }, { tx, singletonKey: stripeSubscriptionId });
    return { outcome: "purchase_not_found", error: "subscription_user_deleted" };
  }
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`sub:${stripeSubscriptionId}`}))`);
  const [existing] = await tx.select().from(subscriptions).where(eq(subscriptions.stripeSubscriptionId, stripeSubscriptionId)).for(LOCK);
  if (existing?.userId && existing.userId !== purchase.userId) {
    log.error({ purchaseId: purchase.id, subscriptionId: existing.id }, "subscription_owner_mismatch");
    await tx.insert(auditLog).values({ userId: purchase.userId, action: "payment.mismatch", targetId: purchase.id, meta: { code: "subscription_owner" } });
    return { outcome: "mismatch", error: "subscription_owner" };
  }
  const now = new Date();
  await tx
    .update(purchases)
    .set({ status: "paid", paidAt: now, stripeCheckoutSessionId: session.id, paymentMethodType: "card", amountPaidCents: session.amount_total })
    .where(eq(purchases.id, purchase.id));
  let subscriptionRowId: string;
  if (existing) {
    // O evento da assinatura chegou antes. Sessão paga = primeira cobrança aprovada: o
    // "incomplete" do evento de criação vira "active"; o resto do status é mantido.
    await tx
      .update(subscriptions)
      .set({
        userId: purchase.userId,
        purchaseId: purchase.id,
        stripeCustomerId: existing.stripeCustomerId ?? idOf(session.customer),
        ...(existing.status === "incomplete" ? { status: "active" } : {}),
      })
      .where(eq(subscriptions.id, existing.id));
    subscriptionRowId = existing.id;
  } else {
    const [created] = await tx
      .insert(subscriptions)
      .values({
        userId: purchase.userId,
        purchaseId: purchase.id,
        stripeSubscriptionId,
        stripeCustomerId: idOf(session.customer),
        // Sessão paga = primeira cobrança aprovada. O fim do período chega com o evento da assinatura.
        status: "active",
        livemode: session.livemode,
      })
      .returning({ id: subscriptions.id });
    subscriptionRowId = created!.id;
  }
  await tx.insert(auditLog).values({
    userId: purchase.userId,
    action: "subscription.started",
    targetId: subscriptionRowId,
    meta: { purchaseId: purchase.id, sessionId: session.id },
  });
  await tx.insert(funnelEvents).values({ event: "subscription_started", reportTypeSlug: slug });
  // Confere o estado na API do Stripe logo depois (corrige eventos fora de ordem).
  await enqueue("subscription_sync", { stripeSubscriptionId }, { tx, singletonKey: stripeSubscriptionId });
  log.info({ purchaseId: purchase.id, subscriptionId: subscriptionRowId }, "subscription_activated");
  return { outcome: "subscription_activated" };
}

export type SubscriptionUnlockResult =
  | { ok: true; reportId: string }
  | { ok: false; reason: "no_subscription" | "limit_reached" | "not_ready" | "not_found" | "already_unlocked" | "main_required" | "needs_user_side"; reportId?: string };

/**
 * A análise foi enviada por uma sessão leve (e-mail digitado, sem login)? Ao liberar pela
 * assinatura, essa sessão perde o acesso: quem digitou o e-mail de um assinante não lê o
 * relatório pago com a cota dele. O dono continua entrando pela sessão verificada.
 */
async function lightSessionCut(tx: Tx, createdBySessionId: string | null): Promise<{ createdBySessionId?: null }> {
  if (!createdBySessionId) return {};
  const [s] = await tx.select({ verified: sessions.verified }).from(sessions).where(eq(sessions.id, createdBySessionId));
  return s?.verified ? {} : { createdBySessionId: null };
}

/** Serializa os usos da assinatura de um usuário (limite diário sem corrida). */
async function lockSubscriptionUse(tx: Tx, userId: string): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`subuse:${userId}`}))`);
}

/**
 * Libera o relatório principal pela assinatura (D96): conta 1 no limite do dia.
 * O chamador já conferiu a sessão VERIFICADA e o dono; aqui tudo é conferido de novo na
 * transação (assinatura ativa travada contra revogação simultânea, dono, estado e limite).
 */
export async function unlockWithSubscription(userId: string, reportId: string): Promise<SubscriptionUnlockResult> {
  return getDb().transaction(async (tx) => {
    await lockSubscriptionUse(tx, userId);
    const sub = await findActiveSubscription(tx, userId, { lock: true });
    if (!sub) return { ok: false, reason: "no_subscription" };
    const [row] = await tx
      .select({
        report: reports,
        kind: reportTypes.kind,
        convUserId: conversations.userId,
        convStatus: conversations.status,
        createdBySessionId: conversations.createdBySessionId,
      })
      .from(reports)
      .innerJoin(reportTypes, eq(reportTypes.id, reports.reportTypeId))
      .innerJoin(conversations, eq(conversations.id, reports.conversationId))
      .where(eq(reports.id, reportId))
      .for("update", { of: reports });
    if (!row || row.convUserId !== userId || row.convStatus === "deleted" || row.kind !== "main") return { ok: false, reason: "not_found" };
    if (row.report.isUnlocked) return { ok: false, reason: "already_unlocked", reportId };
    if (row.report.status !== "ready") return { ok: false, reason: "not_ready" };
    if ((await usedToday(tx, userId)) >= SUBSCRIPTION_DAILY_LIMIT) return { ok: false, reason: "limit_reached" };

    const now = new Date();
    await tx.insert(subscriptionUnlocks).values({ subscriptionId: sub.id, userId, reportId, counts: true, day: todaySql });
    await tx.update(reports).set({ isUnlocked: true, unlockedAt: now }).where(eq(reports.id, reportId));
    await tx
      .update(conversations)
      .set({ expiresAt: computeExpiresAt(true), lastAccessedAt: now, ...(await lightSessionCut(tx, row.createdBySessionId)) })
      .where(eq(conversations.id, row.report.conversationId));
    await tx.insert(auditLog).values({ userId, action: "report.unlocked", targetId: reportId, meta: { via: "subscription", subscriptionId: sub.id, kind: "main" } });
    await tx.insert(funnelEvents).values({ event: "subscription_unlock", reportTypeSlug: "principal" });
    log.info({ reportId, subscriptionId: sub.id }, "report_unlocked_subscription");
    return { ok: true, reportId };
  });
}

/**
 * Relatório adicional incluído na assinatura (D96): não conta no limite diário.
 * Exige o principal da conversa liberado; cria o relatório e enfileira a geração.
 */
export async function unlockExtraWithSubscription(userId: string, conversationId: string, slug: string): Promise<SubscriptionUnlockResult> {
  return getDb().transaction(async (tx) => {
    await lockSubscriptionUse(tx, userId);
    const sub = await findActiveSubscription(tx, userId, { lock: true });
    if (!sub) return { ok: false, reason: "no_subscription" };
    const [conv] = await tx
      .select({
        id: conversations.id,
        userId: conversations.userId,
        status: conversations.status,
        userIs: conversations.userIs,
        createdBySessionId: conversations.createdBySessionId,
      })
      .from(conversations)
      .where(eq(conversations.id, conversationId));
    if (!conv || conv.userId !== userId || conv.status === "deleted") return { ok: false, reason: "not_found" };
    const [rt] = await tx
      .select()
      .from(reportTypes)
      .where(and(eq(reportTypes.slug, slug), eq(reportTypes.kind, "extra"), eq(reportTypes.isActive, true)));
    if (!rt) return { ok: false, reason: "not_found" };
    const [main] = await tx
      .select({ isUnlocked: reports.isUnlocked })
      .from(reports)
      .innerJoin(reportTypes, eq(reportTypes.id, reports.reportTypeId))
      .where(and(eq(reports.conversationId, conv.id), eq(reportTypes.kind, "main")));
    if (!main?.isUnlocked) return { ok: false, reason: "main_required" };
    if (rt.requiresUserSide && conv.userIs === "none") return { ok: false, reason: "needs_user_side" };

    const [report] = await tx
      .insert(reports)
      .values({ conversationId: conv.id, reportTypeId: rt.id, status: "pending_payment" })
      .onConflictDoUpdate({ target: [reports.conversationId, reports.reportTypeId], set: { updatedAt: new Date() } })
      .returning();
    const [locked] = await tx.select().from(reports).where(eq(reports.id, report!.id)).for(LOCK);
    if (!locked) return { ok: false, reason: "not_found" };
    if (locked.isUnlocked) return { ok: false, reason: "already_unlocked", reportId: locked.id };

    const now = new Date();
    await tx.insert(subscriptionUnlocks).values({ subscriptionId: sub.id, userId, reportId: locked.id, counts: false, day: todaySql });
    await tx
      .update(reports)
      .set({ isUnlocked: true, unlockedAt: now, status: "queued", progress: { step: "queued" }, errorCode: null })
      .where(eq(reports.id, locked.id));
    await enqueue("generate_extra", { reportId: locked.id }, { tx, singletonKey: locked.id });
    const cut = await lightSessionCut(tx, conv.createdBySessionId);
    if ("createdBySessionId" in cut) await tx.update(conversations).set(cut).where(eq(conversations.id, conv.id));
    await tx.insert(auditLog).values({ userId, action: "report.unlocked", targetId: locked.id, meta: { via: "subscription", subscriptionId: sub.id, kind: "extra" } });
    await tx.insert(funnelEvents).values({ event: "subscription_extra", reportTypeSlug: rt.slug });
    log.info({ reportId: locked.id, subscriptionId: sub.id }, "extra_unlocked_subscription");
    return { ok: true, reportId: locked.id };
  });
}

/** Volta a bloquear relatórios e ajusta a retenção da análise se nada mais ficar liberado. */
async function relockReports(tx: Tx, reportIds: string[]): Promise<void> {
  if (reportIds.length) {
    // Mantém a contagem do dia, mas solta o vínculo: o relatório pode ser liberado de novo depois.
    await tx.update(subscriptionUnlocks).set({ reportId: null }).where(inArray(subscriptionUnlocks.reportId, reportIds));
  }
  for (const reportId of reportIds) {
    const [revoked] = await tx
      .update(reports)
      .set({ isUnlocked: false, unlockedAt: null })
      .where(eq(reports.id, reportId))
      .returning({ conversationId: reports.conversationId });
    if (!revoked) continue;
    const [stillPaid] = await tx
      .select({ id: reports.id })
      .from(reports)
      .where(and(eq(reports.conversationId, revoked.conversationId), eq(reports.isUnlocked, true)))
      .limit(1);
    if (!stillPaid) await tx.update(conversations).set({ expiresAt: computeExpiresAt(false) }).where(eq(conversations.id, revoked.conversationId));
  }
}

/**
 * Reembolso de uma cobrança da assinatura (D96, como D9): o acesso termina na hora e os
 * relatórios liberados por ela voltam a ficar bloqueados (menos os pagos à parte).
 */
async function revokeSubscriptionsOfCustomer(
  tx: Tx,
  customerId: string,
  stripeObjectId: string,
  reason: "refunded" | "disputed",
): Promise<Result | null> {
  const subs = await tx
    .select()
    .from(subscriptions)
    .where(and(eq(subscriptions.stripeCustomerId, customerId), sql`${subscriptions.revokedAt} IS NULL`))
    .for(LOCK);
  if (subs.length === 0) return null;
  const now = new Date();
  for (const s of subs) {
    await tx.update(subscriptions).set({ revokedAt: now }).where(eq(subscriptions.id, s.id));
    const unlocked = await tx
      .select({ reportId: subscriptionUnlocks.reportId })
      .from(subscriptionUnlocks)
      .where(and(eq(subscriptionUnlocks.subscriptionId, s.id), isNotNull(subscriptionUnlocks.reportId)));
    const ids = unlocked.map((u) => u.reportId!).filter(Boolean);
    const paidApart = ids.length
      ? await tx
          .select({ reportId: purchases.reportId })
          .from(purchases)
          .where(and(inArray(purchases.reportId, ids), eq(purchases.status, "paid")))
      : [];
    const keep = new Set(paidApart.map((p) => p.reportId));
    await relockReports(tx, ids.filter((id) => !keep.has(id)));
    // Encerrada de vez: o Stripe não cobra mais (o job tenta de novo e alerta se falhar).
    if (!(FINAL_STATUSES as readonly string[]).includes(s.status)) {
      await enqueue("subscription_cancel", { stripeSubscriptionId: s.stripeSubscriptionId, reason }, { tx, singletonKey: s.stripeSubscriptionId });
    }
    await tx.insert(auditLog).values({
      userId: s.userId,
      action: reason === "refunded" ? "subscription.revoked_refund" : "subscription.revoked_dispute",
      targetId: s.id,
      meta: { stripeObjectId, relocked: ids.length - keep.size },
    });
    log.warn({ subscriptionId: s.id, reason }, "subscription_access_revoked");
  }
  return { outcome: "revoked" };
}

/** Contestação de cobrança da assinatura (job `subscription_dispute`, depois de achar o cliente na API). */
export async function revokeSubscriptionsForDisputedCharge(customerId: string, chargeId: string): Promise<Result> {
  return getDb().transaction(async (tx) => (await revokeSubscriptionsOfCustomer(tx, customerId, chargeId, "disputed")) ?? { outcome: "ignored" });
}

async function recordPendingSession(tx: Tx, session: Stripe.Checkout.Session): Promise<Result> {
  const found = await findPurchaseForSession(tx, session);
  if (!("row" in found) || !found.row) return { outcome: "purchase_not_found", error: foundError(found) ?? "purchase_not_found" };
  const { purchase } = found.row;
  if (purchase.status === "pending") {
    await tx
      .update(purchases)
      .set({ stripeCheckoutSessionId: session.id, stripePaymentIntentId: idOf(session.payment_intent) })
      .where(eq(purchases.id, purchase.id));
  }
  return { outcome: "awaiting_async_payment" };
}

async function markSession(tx: Tx, session: Stripe.Checkout.Session, status: "failed" | "expired"): Promise<Result> {
  const found = await findPurchaseForSession(tx, session);
  if (!("row" in found) || !found.row) return { outcome: "ignored", error: foundError(found) ?? "purchase_not_found" };
  if (found.row.purchase.status !== "pending") return { outcome: "ignored" };
  await tx.update(purchases).set({ status }).where(eq(purchases.id, found.row.purchase.id));
  return { outcome: status === "failed" ? "marked_failed" : "marked_expired" };
}

/** Reembolso total ou contestação revogam o acesso (D9). */
export async function revokeByPaymentIntent(
  tx: Tx,
  paymentIntentId: string | null,
  status: "refunded" | "disputed",
  stripeObjectId: string,
  customerId: string | null = null,
  chargeId: string | null = null,
): Promise<Result> {
  if (!paymentIntentId) return { outcome: "purchase_not_found", error: "missing_payment_intent" };
  await lockPaymentIntent(tx, paymentIntentId);
  const [purchase] = await tx
    .select()
    .from(purchases)
    .where(and(eq(purchases.stripePaymentIntentId, paymentIntentId), eq(purchases.status, "paid")))
    .for(LOCK);
  if (!purchase && customerId) {
    // Cobrança de assinatura (não tem compra avulsa com este PaymentIntent): revoga a assinatura do cliente.
    const [anyPurchase] = await tx.select({ id: purchases.id }).from(purchases).where(eq(purchases.stripePaymentIntentId, paymentIntentId)).limit(1);
    if (!anyPurchase) {
      const revoked = await revokeSubscriptionsOfCustomer(tx, customerId, stripeObjectId, status);
      if (revoked) return revoked;
    }
  }
  if (!purchase && !customerId && chargeId && status === "disputed") {
    // A contestação não traz o cliente: se não for compra avulsa, o job descobre na API e revoga a assinatura.
    const [anyPurchase] = await tx.select({ id: purchases.id }).from(purchases).where(eq(purchases.stripePaymentIntentId, paymentIntentId)).limit(1);
    if (!anyPurchase) await enqueue("subscription_dispute", { chargeId }, { tx, singletonKey: chargeId });
  }
  if (!purchase) {
    // Ainda não liberado (o webhook do pagamento falhou/atrasou): marca a compra pendente,
    // se conhecida, e deixa um registro pelo PaymentIntent para que a liberação posterior
    // (reenvio do Stripe ou reconciliação) seja recusada.
    const [pending] = await tx
      .select({ id: purchases.id, userId: purchases.userId })
      .from(purchases)
      .where(and(eq(purchases.stripePaymentIntentId, paymentIntentId), eq(purchases.status, "pending")))
      .for(LOCK);
    if (pending) await tx.update(purchases).set({ status }).where(eq(purchases.id, pending.id));
    await tx.insert(auditLog).values({
      userId: pending?.userId ?? null,
      action: "payment.revoked_unmatched",
      targetId: paymentIntentId,
      meta: { status, stripeObjectId },
    });
    log.error({ stripeObjectId, code: "purchase_not_found" }, "stripe_revoke_unmatched");
    return { outcome: "purchase_not_found", error: "revoked_before_unlock" };
  }
  await tx.update(purchases).set({ status }).where(eq(purchases.id, purchase.id));
  // Sem nenhum relatório liberado na análise, volta à retenção de não paga (minimização).
  // Relatório também liberado por uma assinatura vigente (D96) continua liberado.
  if (purchase.reportId) {
    const [viaSubscription] = await tx
      .select({ id: subscriptionUnlocks.id })
      .from(subscriptionUnlocks)
      .innerJoin(subscriptions, eq(subscriptions.id, subscriptionUnlocks.subscriptionId))
      .where(and(eq(subscriptionUnlocks.reportId, purchase.reportId), sql`${subscriptions.revokedAt} IS NULL`))
      .limit(1);
    if (!viaSubscription) await relockReports(tx, [purchase.reportId]);
  }
  await tx.insert(auditLog).values({
    userId: purchase.userId,
    action: status === "refunded" ? "report.revoked_refund" : "report.revoked_dispute",
    targetId: purchase.reportId,
    meta: { purchaseId: purchase.id, stripeObjectId },
  });
  log.warn({ purchaseId: purchase.id, reportId: purchase.reportId, status }, "report_access_revoked");
  return { outcome: "revoked" };
}

async function dispatch(tx: Tx, event: Stripe.Event): Promise<Result> {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object;
      if (session.payment_status === "paid") return unlockFromSession(tx, session);
      // Assinatura sem cobrança na hora (teste grátis, cupom de 100%) não é oferecida: não ativa.
      if (session.mode === "subscription") return { outcome: "mismatch", error: "subscription_unpaid" };
      if (session.payment_status === "unpaid") return recordPendingSession(tx, session);
      return { outcome: "mismatch", error: "no_payment_required" };
    }
    case "checkout.session.async_payment_succeeded":
      return unlockFromSession(tx, event.data.object);
    case "checkout.session.async_payment_failed":
      return markSession(tx, event.data.object, "failed");
    case "checkout.session.expired":
      return markSession(tx, event.data.object, "expired");
    case "charge.refunded": {
      const charge = event.data.object;
      if (!charge.refunded) return { outcome: "partial_refund_ignored" };
      return revokeByPaymentIntent(tx, idOf(charge.payment_intent), "refunded", charge.id, idOf(charge.customer));
    }
    case "charge.dispute.created": {
      const dispute = event.data.object;
      return revokeByPaymentIntent(tx, idOf(dispute.payment_intent), "disputed", dispute.id, null, idOf(dispute.charge));
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const sub = event.data.object;
      const applied = await applySubscriptionState(tx, sub, new Date(event.created * 1000));
      // Relê na API logo depois: a ordem de entrega dos eventos não é garantida.
      await enqueue("subscription_sync", { stripeSubscriptionId: sub.id }, { tx, singletonKey: sub.id });
      return { outcome: applied === "applied" ? "subscription_synced" : "ignored" };
    }
    default:
      return { outcome: "ignored" };
  }
}

/**
 * Processa um evento JÁ VALIDADO (assinatura conferida pelo chamador).
 * Idempotente: `stripe_events.id` registra cada evento; repetições não têm efeito.
 * Erros inesperados propagam (o webhook responde 500 e o Stripe reenvia).
 */
export async function processStripeEvent(event: Stripe.Event): Promise<Result> {
  return getDb().transaction(async (tx) => {
    const inserted = await tx
      .insert(stripeEvents)
      .values({ id: event.id, type: event.type })
      .onConflictDoNothing()
      .returning({ id: stripeEvents.id });
    if (inserted.length === 0) {
      const [existing] = await tx.select().from(stripeEvents).where(eq(stripeEvents.id, event.id)).for(LOCK);
      if (existing?.processedAt) return { outcome: "duplicate_event" as const };
    }
    const result = await dispatch(tx, event);
    await tx
      .update(stripeEvents)
      .set({ processedAt: new Date(), error: result.error ?? null })
      .where(eq(stripeEvents.id, event.id));
    log.info({ eventId: event.id, type: event.type, outcome: result.outcome }, "stripe_event_processed");
    if (result.error) void sendAlert("webhook_stripe_reconciliar", { evento: event.id, erro: result.error });
    return result;
  });
}

/** Reconciliação (R8): libera a partir de uma sessão lida da API autenticada do Stripe. */
export async function fulfillVerifiedSession(session: Stripe.Checkout.Session): Promise<Result> {
  if (session.payment_status !== "paid") return { outcome: "ignored" };
  return getDb().transaction((tx) => unlockFromSession(tx, session));
}
