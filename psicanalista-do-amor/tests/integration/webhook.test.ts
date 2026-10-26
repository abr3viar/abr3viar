import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, expect, it } from "vitest";
import { POST } from "@/app/api/webhooks/stripe/route";
import { closeDb, getDb } from "@/server/db/client";
import { auditLog, conversations, purchases, reports, stripeEvents } from "@/server/db/schema";
import { stopBoss } from "@/server/jobs/boss";
import { describeDb, prepareTestDb } from "../helpers/db";
import { configureTestLinks, createPendingPurchase, createReadyMainReport, createUserWithSession, reportType } from "../helpers/factories";
import { checkoutSession, event, EXTRA_GROSS, PRINCIPAL_GROSS, signedRequest } from "../helpers/stripe-events";

async function setup() {
  const { user } = await createUserWithSession(`u${Math.random()}@example.com`);
  const main = await createReadyMainReport(user.id);
  const purchase = await createPendingPurchase(user.id, main.report.id);
  return { user, main, purchase };
}

async function reportUnlocked(reportId: string) {
  const [r] = await getDb().select().from(reports).where(eq(reports.id, reportId));
  return r!.isUnlocked;
}

async function purchaseOf(id: string) {
  const [p] = await getDb().select().from(purchases).where(eq(purchases.id, id));
  return p!;
}

async function jobsCount(name: string) {
  const res = await getDb().execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM pgboss.job WHERE name = ${name}`);
  return res.rows[0]!.n;
}

describeDb("webhook do Stripe", () => {
  beforeEach(async () => {
    await prepareTestDb();
    await configureTestLinks();
  });
  afterAll(async () => {
    await stopBoss();
    await closeDb();
  });

  it("rejeita assinatura ausente ou inválida (400) sem efeito", async () => {
    const { main, purchase } = await setup();
    const evt = event("checkout.session.completed", checkoutSession({ client_reference_id: purchase.id }));
    const noSig = new Request("http://localhost/api/webhooks/stripe", { method: "POST", body: JSON.stringify(evt) });
    expect((await POST(noSig)).status).toBe(400);
    expect((await POST(signedRequest(evt, "whsec_outro_segredo"))).status).toBe(400);
    expect(await reportUnlocked(main.report.id)).toBe(false);
    expect(await getDb().select().from(stripeEvents)).toHaveLength(0);
  });

  it("libera com pagamento válido e é idempotente (mesmo evento 3 vezes)", async () => {
    const { main, purchase } = await setup();
    const evt = event("checkout.session.completed", checkoutSession({ client_reference_id: purchase.id }));
    for (let i = 0; i < 3; i++) {
      const res = await POST(signedRequest(evt));
      expect(res.status).toBe(200);
    }
    expect(await reportUnlocked(main.report.id)).toBe(true);
    const p = await purchaseOf(purchase.id);
    expect(p.status).toBe("paid");
    expect(p.paidAt).not.toBeNull();
    const audits = await getDb().select().from(auditLog).where(eq(auditLog.action, "report.unlocked"));
    expect(audits).toHaveLength(1);
    const evts = await getDb().select().from(stripeEvents);
    expect(evts).toHaveLength(1);
    expect(evts[0]!.processedAt).not.toBeNull();
    expect(await jobsCount("send_email")).toBe(1);
    // Retenção estendida para análise paga (180 dias).
    const [conv] = await getDb().select().from(conversations).where(eq(conversations.id, main.conversation.id));
    expect(conv!.expiresAt.getTime()).toBeGreaterThan(Date.now() + 170 * 86_400_000);
  });

  it("eventos diferentes para a mesma compra liberam uma única vez", async () => {
    const { main, purchase } = await setup();
    const session = checkoutSession({ client_reference_id: purchase.id });
    await POST(signedRequest(event("checkout.session.completed", session)));
    await POST(signedRequest(event("checkout.session.async_payment_succeeded", session)));
    expect(await reportUnlocked(main.report.id)).toBe(true);
    const audits = await getDb().select().from(auditLog).where(eq(auditLog.action, "report.unlocked"));
    expect(audits).toHaveLength(1);
  });

  it("valor menor que o esperado NÃO libera", async () => {
    const { main, purchase } = await setup();
    const res = await POST(signedRequest(event("checkout.session.completed", checkoutSession({ client_reference_id: purchase.id, amount_total: 1000 }))));
    expect(res.status).toBe(200);
    expect(await reportUnlocked(main.report.id)).toBe(false);
    expect((await purchaseOf(purchase.id)).status).toBe("pending");
    const [e] = await getDb().select().from(stripeEvents);
    expect(e!.error).toBe("mismatch_amount");
  });

  it("Payment Link errado (ex.: link de R$ 10 para o relatório de R$ 30) NÃO libera", async () => {
    const { main, purchase } = await setup();
    await POST(
      signedRequest(
        event("checkout.session.completed", checkoutSession({ client_reference_id: purchase.id, payment_link: "plink_test_extra", amount_total: PRINCIPAL_GROSS })),
      ),
    );
    expect(await reportUnlocked(main.report.id)).toBe(false);
    const [e] = await getDb().select().from(stripeEvents);
    expect(e!.error).toBe("mismatch_payment_link");
  });

  it("moeda errada e modo produção x teste NÃO liberam", async () => {
    const { main, purchase } = await setup();
    await POST(signedRequest(event("checkout.session.completed", checkoutSession({ client_reference_id: purchase.id, currency: "usd" }))));
    await POST(signedRequest(event("checkout.session.completed", checkoutSession({ client_reference_id: purchase.id, livemode: true }))));
    expect(await reportUnlocked(main.report.id)).toBe(false);
  });

  it("purchase inexistente ou sem client_reference_id: registra erro, responde 200 e não libera", async () => {
    const { main } = await setup();
    const r1 = await POST(signedRequest(event("checkout.session.completed", checkoutSession({ client_reference_id: "0192f000-0000-7000-8000-000000000000" }))));
    const r2 = await POST(signedRequest(event("checkout.session.completed", checkoutSession({ client_reference_id: null }))));
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(await reportUnlocked(main.report.id)).toBe(false);
    const errs = (await getDb().select().from(stripeEvents)).map((e) => e.error).sort();
    expect(errs).toEqual(["missing_client_reference_id", "purchase_not_found"]);
  });

  it("pagamento assíncrono (Pix): unpaid aguarda; async_payment_succeeded libera; failed marca falha", async () => {
    const { main, purchase } = await setup();
    const session = checkoutSession({ client_reference_id: purchase.id, payment_status: "unpaid" });
    await POST(signedRequest(event("checkout.session.completed", session)));
    expect(await reportUnlocked(main.report.id)).toBe(false);
    expect((await purchaseOf(purchase.id)).stripeCheckoutSessionId).toBe(session.id);
    await POST(signedRequest(event("checkout.session.async_payment_succeeded", { ...session, payment_status: "paid" })));
    expect(await reportUnlocked(main.report.id)).toBe(true);

    const other = await setup();
    const s2 = checkoutSession({ client_reference_id: other.purchase.id, payment_status: "unpaid" });
    await POST(signedRequest(event("checkout.session.async_payment_failed", s2)));
    expect((await purchaseOf(other.purchase.id)).status).toBe("failed");
    expect(await reportUnlocked(other.main.report.id)).toBe(false);
  });

  it("sessão expirada marca a compra como expirada", async () => {
    const { purchase } = await setup();
    await POST(signedRequest(event("checkout.session.expired", checkoutSession({ client_reference_id: purchase.id, payment_status: "unpaid", status: "expired" }))));
    expect((await purchaseOf(purchase.id)).status).toBe("expired");
  });

  it("reembolso total e contestação revogam o acesso; reembolso parcial não", async () => {
    const { main, purchase } = await setup();
    const session = checkoutSession({ client_reference_id: purchase.id, payment_intent: "pi_refund_1" });
    await POST(signedRequest(event("checkout.session.completed", session)));
    expect(await reportUnlocked(main.report.id)).toBe(true);

    await POST(signedRequest(event("charge.refunded", { id: "ch_1", object: "charge", payment_intent: "pi_refund_1", refunded: false, amount_refunded: 500 })));
    expect(await reportUnlocked(main.report.id)).toBe(true);

    await POST(signedRequest(event("charge.refunded", { id: "ch_1", object: "charge", payment_intent: "pi_refund_1", refunded: true, amount_refunded: PRINCIPAL_GROSS })));
    expect(await reportUnlocked(main.report.id)).toBe(false);
    expect((await purchaseOf(purchase.id)).status).toBe("refunded");
    const revoked = await getDb().select().from(auditLog).where(eq(auditLog.action, "report.revoked_refund"));
    expect(revoked).toHaveLength(1);

    const other = await setup();
    await POST(signedRequest(event("checkout.session.completed", checkoutSession({ client_reference_id: other.purchase.id, payment_intent: "pi_dispute_1" }))));
    await POST(signedRequest(event("charge.dispute.created", { id: "dp_1", object: "dispute", payment_intent: "pi_dispute_1", charge: "ch_2" })));
    expect(await reportUnlocked(other.main.report.id)).toBe(false);
    expect((await purchaseOf(other.purchase.id)).status).toBe("disputed");
  });

  it("pagamento em dobro do mesmo relatório não quebra o índice e fica para reconciliação", async () => {
    const { user, main, purchase } = await setup();
    const second = await createPendingPurchase(user.id, main.report.id);
    await POST(signedRequest(event("checkout.session.completed", checkoutSession({ client_reference_id: purchase.id }))));
    const res = await POST(signedRequest(event("checkout.session.completed", checkoutSession({ client_reference_id: second.id }))));
    expect(res.status).toBe(200);
    const paid = await getDb().select().from(purchases).where(and(eq(purchases.reportId, main.report.id), eq(purchases.status, "paid")));
    expect(paid).toHaveLength(1);
    const dup = await getDb().select().from(auditLog).where(eq(auditLog.action, "payment.duplicate"));
    expect(dup).toHaveLength(1);
  });

  it("reembolso que chega ANTES da liberação impede liberar depois (reenvio ou reconciliação)", async () => {
    const { main, purchase } = await setup();
    await POST(signedRequest(event("charge.refunded", { id: "ch_early", object: "charge", payment_intent: "pi_early_1", refunded: true, amount_refunded: PRINCIPAL_GROSS })));
    const res = await POST(signedRequest(event("checkout.session.completed", checkoutSession({ client_reference_id: purchase.id, payment_intent: "pi_early_1" }))));
    expect(res.status).toBe(200);
    expect(await reportUnlocked(main.report.id)).toBe(false);
    expect((await purchaseOf(purchase.id)).status).toBe("refunded");
  });

  it("a mesma compra paga por duas sessões (Pix + cartão) é registrada como cobrança em dobro", async () => {
    const { main, purchase } = await setup();
    await POST(signedRequest(event("checkout.session.completed", checkoutSession({ client_reference_id: purchase.id }))));
    await POST(signedRequest(event("checkout.session.async_payment_succeeded", checkoutSession({ client_reference_id: purchase.id, payment_method_types: ["pix"] }))));
    expect(await reportUnlocked(main.report.id)).toBe(true);
    const dup = await getDb().select().from(auditLog).where(eq(auditLog.action, "payment.duplicate"));
    expect(dup).toHaveLength(1);
    const errors = await getDb().select().from(stripeEvents).where(eq(stripeEvents.error, "duplicate_payment"));
    expect(errors).toHaveLength(1);
  });

  it("reembolso sem outro relatório liberado devolve a análise à retenção de não paga (minimização)", async () => {
    const { main, purchase } = await setup();
    await POST(signedRequest(event("checkout.session.completed", checkoutSession({ client_reference_id: purchase.id, payment_intent: "pi_ret_1" }))));
    const [paid] = await getDb().select().from(conversations).where(eq(conversations.id, main.conversation.id));
    expect(paid!.expiresAt.getTime()).toBeGreaterThan(Date.now() + 100 * 86_400_000);
    await POST(signedRequest(event("charge.refunded", { id: "ch_ret", object: "charge", payment_intent: "pi_ret_1", refunded: true, amount_refunded: PRINCIPAL_GROSS })));
    const [after] = await getDb().select().from(conversations).where(eq(conversations.id, main.conversation.id));
    expect(after!.expiresAt.getTime()).toBeLessThan(Date.now() + 8 * 86_400_000);
  });

  it("pagamento em dobro reprocessado (reenvio/reconciliação) é registrado uma vez só", async () => {
    const { user, main, purchase } = await setup();
    const second = await createPendingPurchase(user.id, main.report.id);
    await POST(signedRequest(event("checkout.session.completed", checkoutSession({ client_reference_id: purchase.id }))));
    const dupSession = checkoutSession({ client_reference_id: second.id });
    await POST(signedRequest(event("checkout.session.completed", dupSession)));
    await POST(signedRequest(event("checkout.session.async_payment_succeeded", dupSession)));
    const dup = await getDb().select().from(auditLog).where(eq(auditLog.action, "payment.duplicate"));
    expect(dup).toHaveLength(1);
  });

  it("adicional pago enfileira generate_extra uma única vez", async () => {
    const { user, main, purchase } = await setup();
    await POST(signedRequest(event("checkout.session.completed", checkoutSession({ client_reference_id: purchase.id }))));
    const rt = await reportType("quem-gosta-mais");
    const [extra] = await getDb()
      .insert(reports)
      .values({ conversationId: main.conversation.id, reportTypeId: rt.id, status: "pending_payment" })
      .returning();
    const p2 = await createPendingPurchase(user.id, extra!.id, "quem-gosta-mais");
    const evt = event("checkout.session.completed", checkoutSession({ client_reference_id: p2.id, payment_link: "plink_test_extra", amount_total: EXTRA_GROSS }));
    await POST(signedRequest(evt));
    await POST(signedRequest(evt));
    const [after] = await getDb().select().from(reports).where(eq(reports.id, extra!.id));
    expect(after!.isUnlocked).toBe(true);
    expect(after!.status).toBe("queued");
    expect(await jobsCount("generate_extra")).toBe(1);
  });
});
