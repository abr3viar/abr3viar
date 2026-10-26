import { eq } from "drizzle-orm";
import { afterAll, beforeEach, expect, it } from "vitest";
import { POST } from "@/app/api/webhooks/stripe/route";
import { closeDb, getDb } from "@/server/db/client";
import { purchases, reports } from "@/server/db/schema";
import { stopBoss } from "@/server/jobs/boss";
import { findLatestPurchaseForUser } from "@/server/payments/latest-purchase";
import { describeDb, prepareTestDb } from "../helpers/db";
import { configureTestLinks, createPendingPurchase, createReadyMainReport, createUserWithSession, reportType } from "../helpers/factories";
import { checkoutSession, event, EXTRA_GROSS, signedRequest } from "../helpers/stripe-events";

/**
 * QA-05: a página /pagamento/retorno acompanha `findLatestPurchaseForUser` (maior created_at),
 * mas o checkout reaproveita compras pendentes antigas (D46). Depois de pagar uma compra
 * reaproveitada, a página acompanha OUTRA compra (pendente) e nunca redireciona.
 */
describeDb("QA — página de retorno do pagamento", () => {
  beforeEach(async () => {
    await prepareTestDb();
    await configureTestLinks();
  });
  afterAll(async () => {
    await stopBoss();
    await closeDb();
  });

  async function scenario() {
    const { user, viewer } = await createUserWithSession(`retorno${Math.random()}@example.com`);
    const main = await createReadyMainReport(user.id);
    await getDb().update(reports).set({ isUnlocked: true }).where(eq(reports.id, main.report.id));
    const db = getDb();
    const rtX = await reportType("quem-gosta-mais");
    const rtY = await reportType("red-flags");
    const [x] = await db.insert(reports).values({ conversationId: main.conversation.id, reportTypeId: rtX.id, status: "pending_payment" }).returning();
    const [y] = await db.insert(reports).values({ conversationId: main.conversation.id, reportTypeId: rtY.id, status: "pending_payment" }).returning();
    // Compra de X (aberta e abandonada) e, minutos depois, compra de Y (abandonada).
    const px = await createPendingPurchase(user.id, x!.id, "quem-gosta-mais");
    await db.update(purchases).set({ createdAt: new Date(Date.now() - 10 * 60_000) }).where(eq(purchases.id, px.id));
    await createPendingPurchase(user.id, y!.id, "red-flags");
    return { user, viewer, x: x!, px };
  }

  async function payReused(px: { id: string }) {
    // O usuário volta ao checkout de X: a compra pendente px é reaproveitada e paga.
    return POST(signedRequest(event("checkout.session.completed", checkoutSession({ client_reference_id: px.id, payment_link: "plink_test_extra", amount_total: EXTRA_GROSS }))));
  }

  it("pré-condição do QA-05: o webhook libera o adicional da compra reaproveitada", async () => {
    const { x, px } = await scenario();
    expect((await payReused(px)).status).toBe(200);
    const [paid] = await getDb().select().from(reports).where(eq(reports.id, x.id));
    expect(paid!.isUnlocked).toBe(true);
  });

  it("QA-05: depois de pagar a compra reaproveitada, o retorno acompanha essa compra", async () => {
    const { viewer, x, px } = await scenario();
    await payReused(px);
    const latest = await findLatestPurchaseForUser(viewer);
    expect(latest?.reportId).toBe(x.id);
  });

  it("QA-05: o ?link=<slug> do retorno escolhe entre as compras do próprio usuário", async () => {
    const { viewer, x } = await scenario();
    expect((await findLatestPurchaseForUser(viewer, "quem-gosta-mais"))?.reportId).toBe(x.id);
    expect((await findLatestPurchaseForUser(viewer, "../../x"))).not.toBeNull(); // slug inválido é ignorado
    const other = await createUserWithSession(`outro${Math.random()}@example.com`);
    expect(await findLatestPurchaseForUser(other.viewer, "quem-gosta-mais")).toBeNull();
  });
});
