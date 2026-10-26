"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getEnv, isStripeLiveMode, stripeFees, stripeFeesFor } from "@/env";
import { grossFromNet, parseBrlToCents } from "@/lib/pricing";
import { checkPaymentLinkPrice } from "@/server/payments/link-check";
import { clearPublicPricesCache } from "@/server/reports/pricing";
import { requireAdmin } from "@/server/auth/admin";
import { getDb } from "@/server/db/client";
import { auditLog, conversations, reportTypes, reports } from "@/server/db/schema";
import { enqueue } from "@/server/jobs/boss";

const linkId = z.union([z.literal(""), z.string().regex(/^plink_[A-Za-z0-9_]{3,200}$/, "ID deve começar com plink_")]);
const linkUrl = z.union([
  z.literal(""),
  z
    .url()
    .refine((u) => {
      const url = new URL(u);
      if (url.protocol === "https:") return true;
      return getEnv().NODE_ENV !== "production" && url.hostname === "localhost";
    }, "Use o endereço https:// do Payment Link"),
]);
const priceBRL = z
  .string()
  .transform((v, ctx) => {
    const cents = parseBrlToCents(v);
    if (cents === null || cents < 50 || cents > 1_000_000) {
      ctx.addIssue({ code: "custom", message: "use o formato 10,00 (entre 0,50 e 10.000)" });
      return z.NEVER;
    }
    return cents;
  });

const reportTypeSchema = z.object({
  id: z.uuid(),
  name: z.string().trim().min(3).max(120),
  teaser: z.string().trim().min(3).max(240),
  description: z.string().trim().min(3).max(1000),
  netPrice: priceBRL,
  currency: z.literal("brl"),
  sortOrder: z.coerce.number().int().min(0).max(10_000),
  isActive: z.enum(["on"]).optional(),
  stripePaymentLinkId: linkId,
  stripePaymentLinkUrl: linkUrl,
  stripeTestPaymentLinkId: linkId,
  stripeTestPaymentLinkUrl: linkUrl,
  promptTemplate: z.string().max(20_000).optional(),
});

const nullIfEmpty = (v: string) => (v === "" ? null : v);

/**
 * Erros voltam para a página como CÓDIGOS fixos (+ números/nomes de campo validados lá);
 * nenhum texto livre da URL é exibido no painel.
 */
function fail(code: string, extra: Record<string, string> = {}): never {
  redirect(`/admin/relatorios?${new URLSearchParams({ erro: code, ...extra }).toString()}`);
}

function invalidForm(issues: z.core.$ZodIssue[]): never {
  const fields = [...new Set(issues.map((i) => String(i.path[0] ?? "")))].filter(Boolean).join(",");
  fail("invalid_form", { campos: fields });
}

export async function updateReportTypeAction(form: FormData): Promise<void> {
  const admin = await requireAdmin();
  const parsed = reportTypeSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) invalidForm(parsed.error.issues);
  const d = parsed.data;
  if (Boolean(d.stripePaymentLinkId) !== Boolean(d.stripePaymentLinkUrl) || Boolean(d.stripeTestPaymentLinkId) !== Boolean(d.stripeTestPaymentLinkUrl)) {
    fail("link_pair");
  }
  const db = getDb();
  const [current] = await db.select().from(reportTypes).where(eq(reportTypes.id, d.id));
  if (!current) redirect("/admin/relatorios");
  const netPriceCents = d.netPrice;
  const priceCents = grossFromNet(netPriceCents, stripeFeesFor(current.kind));

  // Confere ANTES de gravar se o Payment Link do modo atual cobra exatamente o preço
  // calculado (melhor esforço: sem acesso ao Stripe, salva e a página avisa para conferir).
  const live = isStripeLiveMode();
  const modeLinkId = live ? d.stripePaymentLinkId : d.stripeTestPaymentLinkId;
  const modeLinkUrl = live ? d.stripePaymentLinkUrl : d.stripeTestPaymentLinkUrl;
  const check = modeLinkId
    ? await checkPaymentLinkPrice(
        modeLinkId,
        priceCents,
        modeLinkUrl,
        current.kind === "subscription" ? "monthly" : "one_time",
        current.kind === "subscription" || current.kind === "overage" ? current.slug : undefined,
      )
    : null;
  // Link divergente NÃO fica salvo: sem link, o botão de compra fica desabilitado, e ninguém
  // paga um valor diferente do anunciado nem fica sem liberação por mismatch_amount.
  const dropModeLink = check !== null && !check.ok && check.reason !== "unavailable";
  // Em PRODUÇÃO, sem conseguir conferir no Stripe, link e preço novos não entram: ficam os
  // anteriores e o painel pede para tentar de novo (nada de cobrar sem conferir).
  const linkChanged =
    (live ? current.stripePaymentLinkId : current.stripeTestPaymentLinkId) !== nullIfEmpty(modeLinkId) ||
    (live ? current.stripePaymentLinkUrl : current.stripeTestPaymentLinkUrl) !== nullIfEmpty(modeLinkUrl) ||
    current.priceCents !== priceCents;
  const keepPrevious = live && check !== null && !check.ok && check.reason === "unavailable" && linkChanged;
  if (keepPrevious) fail("link_unavailable_live");
  const links = {
    stripePaymentLinkId: nullIfEmpty(d.stripePaymentLinkId),
    stripePaymentLinkUrl: nullIfEmpty(d.stripePaymentLinkUrl),
    stripeTestPaymentLinkId: nullIfEmpty(d.stripeTestPaymentLinkId),
    stripeTestPaymentLinkUrl: nullIfEmpty(d.stripeTestPaymentLinkUrl),
  };
  if (dropModeLink) {
    if (live) Object.assign(links, { stripePaymentLinkId: null, stripePaymentLinkUrl: null });
    else Object.assign(links, { stripeTestPaymentLinkId: null, stripeTestPaymentLinkUrl: null });
  }
  await db
    .update(reportTypes)
    .set({
      name: d.name,
      teaser: d.teaser,
      description: d.description,
      netPriceCents,
      priceCents,
      currency: d.currency,
      sortOrder: d.sortOrder,
      isActive: current.kind === "main" ? true : d.isActive === "on",
      ...links,
      ...(current.kind === "extra" && d.promptTemplate ? { promptTemplate: d.promptTemplate } : {}),
    })
    .where(eq(reportTypes.id, d.id));
  await db.insert(auditLog).values({
    userId: admin.userId,
    action: "admin.report_type_updated",
    targetId: d.id,
    meta: check ? { linkCheck: check.ok ? "ok" : check.reason } : {},
  });
  revalidatePath("/admin/relatorios");
  clearPublicPricesCache();
  if (check && !check.ok && check.reason !== "unavailable") {
    if (check.reason === "price_mismatch") fail("link_price", { link: String(check.linkCents), esperado: String(check.expectedCents) });
    fail(check.reason === "link_options" ? "link_options" : `link_${check.reason}`);
  }
  redirect(`/admin/relatorios?ok=${check?.ok ? "conferido" : check ? "sem-conferencia" : "1"}`);
}

const newTypeSchema = z.object({
  slug: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "slug em minúsculas com hífens").max(64),
  name: z.string().trim().min(3).max(120),
  teaser: z.string().trim().min(3).max(240),
  description: z.string().trim().min(3).max(1000),
  netPrice: priceBRL,
  promptTemplate: z.string().trim().min(50).max(20_000),
});

export async function createReportTypeAction(form: FormData): Promise<void> {
  const admin = await requireAdmin();
  const parsed = newTypeSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) invalidForm(parsed.error.issues);
  const d = parsed.data;
  const db = getDb();
  const [exists] = await db.select({ id: reportTypes.id }).from(reportTypes).where(eq(reportTypes.slug, d.slug));
  if (exists) fail("slug_exists");
  const [created] = await db
    .insert(reportTypes)
    .values({
      slug: d.slug,
      kind: "extra",
      name: d.name,
      teaser: d.teaser,
      description: d.description,
      netPriceCents: d.netPrice,
      priceCents: grossFromNet(d.netPrice, stripeFees()),
      currency: "brl",
      promptTemplate: d.promptTemplate,
      sortOrder: 100,
      isActive: false,
    })
    .returning({ id: reportTypes.id });
  await db.insert(auditLog).values({ userId: admin.userId, action: "admin.report_type_created", targetId: created!.id });
  clearPublicPricesCache();
  redirect("/admin/relatorios?ok=1");
}

/** Reprocessa uma análise ou relatório que falhou (sem nova cobrança). */
export async function adminRetryAction(form: FormData): Promise<void> {
  const admin = await requireAdmin();
  const kind = String(form.get("kind"));
  const id = String(form.get("id"));
  if (!z.uuid().safeParse(id).success) redirect("/admin/operacoes");
  const db = getDb();
  if (kind === "conversation") {
    const [c] = await db.select().from(conversations).where(eq(conversations.id, id));
    if (c?.status === "failed") {
      await db.transaction(async (tx) => {
        if (c.participantAName && c.messageCount > 0) {
          await tx.update(conversations).set({ status: "generating", errorCode: null, progress: { step: "queued" } }).where(eq(conversations.id, id));
          await tx.update(reports).set({ status: "queued", errorCode: null }).where(and(eq(reports.conversationId, id), eq(reports.status, "failed")));
          await enqueue("generate_main", { conversationId: id }, { tx, singletonKey: id });
        } else {
          await tx.update(conversations).set({ status: "uploaded", errorCode: null, progress: { step: "received" } }).where(eq(conversations.id, id));
          await enqueue("ingest", { conversationId: id }, { tx, singletonKey: id });
        }
      });
    }
  } else if (kind === "report") {
    const [r] = await db.select().from(reports).where(eq(reports.id, id));
    if (r?.status === "failed" && r.isUnlocked) {
      await db.transaction(async (tx) => {
        await tx.update(reports).set({ status: "queued", errorCode: null }).where(eq(reports.id, id));
        await enqueue("generate_extra", { reportId: id }, { tx, singletonKey: id });
      });
    }
  }
  await db.insert(auditLog).values({ userId: admin.userId, action: "admin.retry", targetId: id, meta: { kind } });
  redirect("/admin/operacoes?ok=1");
}

/** Dispara jobs de manutenção sob demanda. */
export async function adminRunJobAction(form: FormData): Promise<void> {
  const admin = await requireAdmin();
  const job = z.enum(["retention", "cleanup_files", "reconcile_payments", "rotate_encryption_key"]).safeParse(form.get("job"));
  if (!job.success) redirect("/admin/operacoes");
  await enqueue(job.data, {});
  await getDb().insert(auditLog).values({ userId: admin.userId, action: "admin.run_job", meta: { job: job.data } });
  redirect("/admin/operacoes?ok=1");
}
