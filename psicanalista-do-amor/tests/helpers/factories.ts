import { eq } from "drizzle-orm";
import { encryptField } from "@/server/crypto";
import { getDb } from "@/server/db/client";
import { conversations, purchases, reportTypes, reports, sessions, users } from "@/server/db/schema";
import { replaceSections, type SectionToSave } from "@/server/reports/sections";

export const TEST_LINKS = {
  principal: { id: "plink_test_principal", url: "https://buy.stripe.com/test_principal" },
  extra: { id: "plink_test_extra", url: "https://buy.stripe.com/test_extra" },
  subscription: { id: "plink_test_assinatura", url: "https://buy.stripe.com/test_assinatura" },
  overage: { id: "plink_test_excedente", url: "https://buy.stripe.com/test_excedente" },
};

export async function configureTestLinks() {
  const db = getDb();
  await db
    .update(reportTypes)
    .set({ stripeTestPaymentLinkId: TEST_LINKS.principal.id, stripeTestPaymentLinkUrl: TEST_LINKS.principal.url })
    .where(eq(reportTypes.slug, "principal"));
  await db
    .update(reportTypes)
    .set({ stripeTestPaymentLinkId: TEST_LINKS.extra.id, stripeTestPaymentLinkUrl: TEST_LINKS.extra.url })
    .where(eq(reportTypes.slug, "quem-gosta-mais"));
  await db
    .update(reportTypes)
    .set({ stripeTestPaymentLinkId: TEST_LINKS.subscription.id, stripeTestPaymentLinkUrl: TEST_LINKS.subscription.url })
    .where(eq(reportTypes.slug, "assinatura-mensal"));
  await db
    .update(reportTypes)
    .set({ stripeTestPaymentLinkId: TEST_LINKS.overage.id, stripeTestPaymentLinkUrl: TEST_LINKS.overage.url })
    .where(eq(reportTypes.slug, "relatorio-alem-do-limite"));
}

/** Compra pendente da assinatura (sem relatório), como o startSubscriptionCheckout cria. */
export async function createPendingSubscriptionPurchase(userId: string) {
  const rt = await reportType("assinatura-mensal");
  const [p] = await getDb()
    .insert(purchases)
    .values({ userId, reportTypeId: rt.id, amountCents: rt.priceCents, currency: "brl", livemode: false })
    .returning();
  return p!;
}

export async function reportType(slug: string) {
  const [rt] = await getDb().select().from(reportTypes).where(eq(reportTypes.slug, slug));
  return rt!;
}

export async function createUserWithSession(email: string, verified = true) {
  const db = getDb();
  const [user] = await db.insert(users).values({ email }).returning();
  const [session] = await db
    .insert(sessions)
    .values({ userId: user!.id, tokenHash: `hash-${email}-${Math.random()}`, verified, expiresAt: new Date(Date.now() + 86_400_000) })
    .returning();
  return {
    user: user!,
    viewer: { sessionId: session!.id, userId: user!.id, email, verified, isAdmin: false },
  };
}

export const SECRET = "SEGREDO-BLOQUEADO";

export function sampleSections(): SectionToSave[] {
  const keys = ["retrato", "ritmo", "temas", "estilos", "virada", "investimento", "pontos-de-atrito", "leitura-final"];
  return keys.map((key, i) => ({
    key,
    title: i < 4 ? `Aberto ${key}` : `${SECRET}-titulo-${key}`,
    lockedTitle: i < 4 ? `Aberto ${key}` : `Instigante ${i + 1}`,
    content: i < 4 ? `Conteúdo livre ${key} `.repeat(10) : `${SECRET}-conteudo-${key} `.repeat(10),
    evidence: [{ seq: 1, quote: i < 4 ? "citação livre" : `${SECRET}-citacao` }],
    isSafety: false,
  }));
}

export async function createReadyMainReport(userId: string, opts: { createdBySessionId?: string; safety?: boolean } = {}) {
  const db = getDb();
  const rt = await reportType("principal");
  const [conv] = await db
    .insert(conversations)
    .values({
      userId,
      createdBySessionId: opts.createdBySessionId ?? null,
      sourceType: "paste",
      status: "ready",
      participantAName: encryptField("Ana"),
      participantBName: encryptField("Lucas"),
      messageCount: 30,
      expiresAt: new Date(Date.now() + 7 * 86_400_000),
    })
    .returning();
  const [report] = await db
    .insert(reports)
    .values({ conversationId: conv!.id, reportTypeId: rt.id, status: "ready", hookText: encryptField("Gancho de teste com Lucas") })
    .returning();
  const sections = sampleSections();
  if (opts.safety) {
    sections.unshift({ key: "alerta", title: "Um cuidado importante", lockedTitle: "Um cuidado importante", content: "ALERTA-VISIVEL", evidence: [], isSafety: true });
  }
  await db.transaction((tx) => replaceSections(tx, report!.id, sections, "main"));
  if (opts.safety) await db.update(reports).set({ safetyFlag: true }).where(eq(reports.id, report!.id));
  return { conversation: conv!, report: report!, reportType: rt };
}

export async function createPendingPurchase(userId: string, reportId: string, slug = "principal") {
  const rt = await reportType(slug);
  const [p] = await getDb()
    .insert(purchases)
    .values({ userId, reportId, reportTypeId: rt.id, amountCents: rt.priceCents, currency: "brl", livemode: false })
    .returning();
  return p!;
}
