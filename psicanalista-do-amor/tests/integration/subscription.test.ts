import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, expect, it, vi } from "vitest";
import { POST } from "@/app/api/webhooks/stripe/route";
import { SUBSCRIPTION_DAILY_LIMIT } from "@/lib/subscription";
import { closeDb, getDb } from "@/server/db/client";
import { auditLog, conversations, purchases, reportTypes, reports, sessions, subscriptionUnlocks, subscriptions, users } from "@/server/db/schema";
import { stopBoss } from "@/server/jobs/boss";
import { revokeSubscriptionsForDisputedCharge, unlockExtraWithSubscription, unlockWithSubscription } from "@/server/payments/fulfill";
import { runRetention } from "@/server/maintenance/retention";
import { clearPublicPricesCache, publicPrices } from "@/server/reports/pricing";
import { startCheckout, startSubscriptionCheckout } from "@/server/payments/start-checkout";
import { cancelUserSubscriptions, subscriptionStateFor, syncOpenSubscriptions } from "@/server/payments/subscriptions";
import { getReportView } from "@/server/reports/get-report-view";
import { describeDb, prepareTestDb } from "../helpers/db";
import {
  configureTestLinks,
  createPendingPurchase,
  createPendingSubscriptionPurchase,
  createReadyMainReport,
  createUserWithSession,
  SECRET,
  TEST_LINKS,
} from "../helpers/factories";
import { checkoutSession, event, OVERAGE_GROSS, signedRequest, stripeSubscription, SUBSCRIPTION_GROSS } from "../helpers/stripe-events";

// startCheckout lê o IP dos cabeçalhos da requisição (rate limit).
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "203.0.113.9" }),
  cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }),
}));

type Viewer = Awaited<ReturnType<typeof createUserWithSession>>["viewer"];

async function post(evt: unknown) {
  const res = await POST(signedRequest(evt));
  expect(res.status).toBe(200);
  return (await res.json()) as { outcome: string };
}

/** Assinante de verdade: compra pendente → checkout pago (webhook) → evento da assinatura. */
async function subscribe(viewer: Viewer, sub = stripeSubscription()) {
  const purchase = await createPendingSubscriptionPurchase(viewer.userId);
  const session = checkoutSession({
    client_reference_id: purchase.id,
    payment_link: TEST_LINKS.subscription.id,
    amount_total: SUBSCRIPTION_GROSS,
    mode: "subscription",
    payment_intent: null,
    subscription: sub.id,
    customer: sub.customer,
  });
  expect((await post(event("checkout.session.completed", session))).outcome).toBe("subscription_activated");
  expect((await post(event("customer.subscription.updated", sub))).outcome).toBe("subscription_synced");
  return { purchase, sub, session };
}

async function newUser(verified = true) {
  return createUserWithSession(`u${Math.random()}@example.com`, verified);
}

async function jobs(name: string) {
  const res = await getDb().execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM pgboss.job WHERE name = ${name}`);
  return res.rows[0]!.n;
}

async function isUnlocked(reportId: string) {
  const [r] = await getDb().select().from(reports).where(eq(reports.id, reportId));
  return r!.isUnlocked;
}

describeDb("assinatura mensal (D96)", () => {
  beforeEach(async () => {
    await prepareTestDb();
    await configureTestLinks();
  });
  afterAll(async () => {
    await stopBoss();
    await closeDb();
  });

  it("o seed cria a assinatura e o relatório além do limite com o preço bruto (R$ 49,35 e R$ 5,62)", async () => {
    const rows = await getDb().select().from(reportTypes).where(sql`${reportTypes.kind} IN ('subscription', 'overage')`);
    const bySlug = Object.fromEntries(rows.map((r) => [r.slug, r]));
    expect(bySlug["assinatura-mensal"]).toMatchObject({ kind: "subscription", netPriceCents: 4699, priceCents: 4935 });
    expect(bySlug["relatorio-alem-do-limite"]).toMatchObject({ kind: "overage", netPriceCents: 500, priceCents: 562 });
    expect(SUBSCRIPTION_GROSS).toBe(4935);
    expect(OVERAGE_GROSS).toBe(562);
  });

  it("checkout pago ativa a assinatura da conta, de forma idempotente, e guarda o fim do período", async () => {
    const { viewer } = await newUser();
    const purchase = await createPendingSubscriptionPurchase(viewer.userId);
    const sub = stripeSubscription();
    const evt = event(
      "checkout.session.completed",
      checkoutSession({
        client_reference_id: purchase.id,
        payment_link: TEST_LINKS.subscription.id,
        amount_total: SUBSCRIPTION_GROSS,
        mode: "subscription",
        payment_intent: null,
        subscription: sub.id,
        customer: sub.customer,
      }),
    );
    expect((await post(evt)).outcome).toBe("subscription_activated");
    expect((await post(evt)).outcome).toBe("duplicate_event");
    const [p] = await getDb().select().from(purchases).where(eq(purchases.id, purchase.id));
    expect(p!.status).toBe("paid");
    const rows = await getDb().select().from(subscriptions);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: viewer.userId, status: "active", stripeSubscriptionId: sub.id, purchaseId: purchase.id });
    expect((await subscriptionStateFor(viewer))?.active).toBe(true);

    await post(event("customer.subscription.updated", sub));
    const [synced] = await getDb().select().from(subscriptions);
    expect(synced!.currentPeriodEnd!.getTime()).toBe(sub.items.data[0]!.current_period_end * 1000);
  });

  it("evento da assinatura antes do checkout: a linha nasce sem dono e o checkout liga à conta", async () => {
    const { viewer } = await newUser();
    const sub = stripeSubscription();
    expect((await post(event("customer.subscription.created", sub))).outcome).toBe("subscription_synced");
    const [orphan] = await getDb().select().from(subscriptions);
    expect(orphan!.userId).toBeNull();
    // Sem dono, não dá direito a nada.
    expect(await subscriptionStateFor(viewer)).toBeNull();
    const purchase = await createPendingSubscriptionPurchase(viewer.userId);
    await post(
      event(
        "checkout.session.completed",
        checkoutSession({ client_reference_id: purchase.id, payment_link: TEST_LINKS.subscription.id, amount_total: SUBSCRIPTION_GROSS, mode: "subscription", payment_intent: null, subscription: sub.id, customer: sub.customer }),
      ),
    );
    const [linked] = await getDb().select().from(subscriptions);
    expect(linked!.userId).toBe(viewer.userId);
    expect(linked!.currentPeriodEnd).not.toBeNull();
    expect((await subscriptionStateFor(viewer))?.active).toBe(true);
  });

  it("recusa link, modo ou valor errados (assinatura × pagamento avulso)", async () => {
    const { viewer } = await newUser();
    const subPurchase = await createPendingSubscriptionPurchase(viewer.userId);
    // Assinatura paga por sessão de pagamento avulso: não ativa.
    const wrongMode = await post(
      event("checkout.session.completed", checkoutSession({ client_reference_id: subPurchase.id, payment_link: TEST_LINKS.subscription.id, amount_total: SUBSCRIPTION_GROSS, mode: "payment" })),
    );
    expect(wrongMode.outcome).toBe("mismatch");
    // Valor menor que o preço: não ativa.
    const cheap = await post(
      event("checkout.session.completed", checkoutSession({ client_reference_id: subPurchase.id, payment_link: TEST_LINKS.subscription.id, amount_total: 1000, mode: "subscription", payment_intent: null, subscription: "sub_x" })),
    );
    expect(cheap.outcome).toBe("mismatch");
    // Relatório principal pago por sessão de assinatura: não libera.
    const main = await createReadyMainReport(viewer.userId);
    const mainPurchase = await createPendingPurchase(viewer.userId, main.report.id);
    const asSub = await post(event("checkout.session.completed", checkoutSession({ client_reference_id: mainPurchase.id, mode: "subscription", subscription: "sub_y" })));
    expect(asSub.outcome).toBe("mismatch");
    expect(await isUnlocked(main.report.id)).toBe(false);
    expect(await getDb().select().from(subscriptions)).toHaveLength(0);
    // Sessão de assinatura sem cobrança (teste grátis/cupom 100%) não ativa.
    const unpaid = await post(event("checkout.session.completed", checkoutSession({ client_reference_id: subPurchase.id, payment_link: TEST_LINKS.subscription.id, mode: "subscription", payment_status: "no_payment_required", subscription: "sub_z" })));
    expect(unpaid.outcome).toBe("mismatch");
  });

  it(`libera até ${SUBSCRIPTION_DAILY_LIMIT} relatórios completos por dia; o seguinte pede o pagamento à parte`, async () => {
    const { viewer } = await newUser();
    await subscribe(viewer);
    const mains = [];
    for (let i = 0; i < SUBSCRIPTION_DAILY_LIMIT + 1; i++) mains.push(await createReadyMainReport(viewer.userId));
    for (let i = 0; i < SUBSCRIPTION_DAILY_LIMIT; i++) {
      expect(await unlockWithSubscription(viewer.userId, mains[i]!.report.id)).toEqual({ ok: true, reportId: mains[i]!.report.id });
    }
    const last = mains[SUBSCRIPTION_DAILY_LIMIT]!;
    expect(await unlockWithSubscription(viewer.userId, last.report.id)).toEqual({ ok: false, reason: "limit_reached" });
    expect(await isUnlocked(last.report.id)).toBe(false);
    // O mesmo relatório duas vezes não gasta a cota de novo.
    expect(await unlockWithSubscription(viewer.userId, mains[0]!.report.id)).toMatchObject({ ok: false, reason: "already_unlocked" });
    const state = await subscriptionStateFor(viewer);
    expect(state).toMatchObject({ active: true, usedToday: SUBSCRIPTION_DAILY_LIMIT, remainingToday: 0 });
    // Conteúdo liberado sai inteiro pela view (o recorte continua no getReportView).
    const view = await getReportView(mains[0]!.report.id, viewer);
    expect(view?.isUnlocked).toBe(true);
    expect(JSON.stringify(view)).toContain(SECRET);
    // Retenção de análise paga.
    const [conv] = await getDb().select().from(conversations).where(eq(conversations.id, mains[0]!.conversation.id));
    expect(conv!.expiresAt.getTime()).toBeGreaterThan(Date.now() + 100 * 86_400_000);
  });

  it("usos de ontem não contam no limite de hoje", async () => {
    const { viewer } = await newUser();
    await subscribe(viewer);
    const [sub] = await getDb().select().from(subscriptions);
    for (let i = 0; i < SUBSCRIPTION_DAILY_LIMIT; i++) {
      const m = await createReadyMainReport(viewer.userId);
      await getDb().insert(subscriptionUnlocks).values({ subscriptionId: sub!.id, userId: viewer.userId, reportId: m.report.id, counts: true, day: sql`((now() AT TIME ZONE 'America/Sao_Paulo')::date - 1)` });
    }
    const today = await createReadyMainReport(viewer.userId);
    expect(await unlockWithSubscription(viewer.userId, today.report.id)).toMatchObject({ ok: true });
  });

  it("pedidos simultâneos não passam do limite diário", async () => {
    const { viewer } = await newUser();
    await subscribe(viewer);
    const mains = [];
    for (let i = 0; i < SUBSCRIPTION_DAILY_LIMIT + 4; i++) mains.push(await createReadyMainReport(viewer.userId));
    const results = await Promise.all(mains.map((m) => unlockWithSubscription(viewer.userId, m.report.id)));
    expect(results.filter((r) => r.ok)).toHaveLength(SUBSCRIPTION_DAILY_LIMIT);
    expect(results.filter((r) => !r.ok && r.reason === "limit_reached")).toHaveLength(4);
  });

  it("sem assinatura, assinatura de outra conta ou relatório de outra pessoa: não libera", async () => {
    const a = await newUser();
    const b = await newUser();
    const mainA = await createReadyMainReport(a.viewer.userId);
    expect(await unlockWithSubscription(a.viewer.userId, mainA.report.id)).toEqual({ ok: false, reason: "no_subscription" });
    await subscribe(b.viewer);
    // B assina, mas o relatório é de A.
    expect(await unlockWithSubscription(b.viewer.userId, mainA.report.id)).toEqual({ ok: false, reason: "not_found" });
    expect(await isUnlocked(mainA.report.id)).toBe(false);
  });

  it("sessão não verificada nunca enxerga nem usa a assinatura do e-mail", async () => {
    const owner = await newUser();
    await subscribe(owner.viewer);
    // Alguém digitou o e-mail do assinante num envio: sessão leve, não verificada, do mesmo usuário.
    const unverified = { ...owner.viewer, sessionId: owner.viewer.sessionId, verified: false };
    expect(await subscriptionStateFor(unverified)).toBeNull();
    expect(await startSubscriptionCheckout(unverified)).toEqual({ ok: false, error: "login_required" });
    const main = await createReadyMainReport(owner.viewer.userId, { createdBySessionId: owner.viewer.sessionId });
    expect(await startCheckout(unverified, main.conversation.id, "relatorio-alem-do-limite")).toMatchObject({ ok: false, error: "login_required" });
  });

  it("past_due e cancelada encerram o uso; evento antigo fora de ordem é ignorado", async () => {
    const { viewer } = await newUser();
    const { sub } = await subscribe(viewer);
    const main = await createReadyMainReport(viewer.userId);
    const now = Math.floor(Date.now() / 1000);
    await post(event("customer.subscription.updated", { ...sub, status: "past_due" }, undefined, now + 10));
    expect(await unlockWithSubscription(viewer.userId, main.report.id)).toEqual({ ok: false, reason: "no_subscription" });
    // Evento mais antigo (ainda "active") chegando depois não reativa.
    expect((await post(event("customer.subscription.updated", { ...sub, status: "active" }, undefined, now - 100))).outcome).toBe("ignored");
    expect((await subscriptionStateFor(viewer))?.active).toBe(false);
    await post(event("customer.subscription.updated", { ...sub, status: "active" }, undefined, now + 20));
    expect((await subscriptionStateFor(viewer))?.active).toBe(true);
    await post(event("customer.subscription.deleted", { ...sub, status: "canceled" }, undefined, now + 30));
    expect(await subscriptionStateFor(viewer)).toMatchObject({ active: false, status: "canceled" });
    expect(await startSubscriptionCheckout(viewer)).toMatchObject({ ok: true });
  });

  it("período vencido sem renovação não dá acesso", async () => {
    const { viewer } = await newUser();
    await subscribe(viewer, stripeSubscription({}, Math.floor(Date.now() / 1000) - 60));
    expect((await subscriptionStateFor(viewer))?.active).toBe(false);
  });

  it("relatório além do limite: só para assinante sem cota no dia; o webhook libera pelo link próprio", async () => {
    const { viewer } = await newUser();
    const extraMain = await createReadyMainReport(viewer.userId);
    // Não assinante: o valor de assinante não vale.
    expect(await startCheckout(viewer, extraMain.conversation.id, "relatorio-alem-do-limite")).toMatchObject({ ok: false, error: "overage_not_allowed" });
    await subscribe(viewer);
    // Assinante com cota sobrando: ainda não.
    expect(await startCheckout(viewer, extraMain.conversation.id, "relatorio-alem-do-limite")).toMatchObject({ ok: false, error: "overage_not_allowed" });
    for (let i = 0; i < SUBSCRIPTION_DAILY_LIMIT; i++) {
      const m = await createReadyMainReport(viewer.userId);
      await unlockWithSubscription(viewer.userId, m.report.id);
    }
    const started = await startCheckout(viewer, extraMain.conversation.id, "relatorio-alem-do-limite");
    expect(started.ok).toBe(true);
    const url = new URL((started as { url: string }).url);
    expect(url.origin + url.pathname).toBe(TEST_LINKS.overage.url);
    const purchaseId = url.searchParams.get("client_reference_id")!;
    const [p] = await getDb().select().from(purchases).where(eq(purchases.id, purchaseId));
    expect(p).toMatchObject({ reportId: extraMain.report.id, amountCents: OVERAGE_GROSS });
    // Pago com o link do principal (outro valor/link): recusado.
    expect((await post(event("checkout.session.completed", checkoutSession({ client_reference_id: purchaseId, amount_total: OVERAGE_GROSS })))).outcome).toBe("mismatch");
    expect(await isUnlocked(extraMain.report.id)).toBe(false);
    const ok = await post(event("checkout.session.completed", checkoutSession({ client_reference_id: purchaseId, payment_link: TEST_LINKS.overage.id, amount_total: OVERAGE_GROSS })));
    expect(ok.outcome).toBe("unlocked");
    expect(await isUnlocked(extraMain.report.id)).toBe(true);
  });

  it("adicionais incluídos: não contam no limite, exigem o principal liberado e enfileiram a geração", async () => {
    const { viewer } = await newUser();
    await subscribe(viewer);
    const main = await createReadyMainReport(viewer.userId);
    expect(await unlockExtraWithSubscription(viewer.userId, main.conversation.id, "quem-gosta-mais")).toEqual({ ok: false, reason: "main_required" });
    await unlockWithSubscription(viewer.userId, main.report.id);
    const r = await unlockExtraWithSubscription(viewer.userId, main.conversation.id, "quem-gosta-mais");
    expect(r.ok).toBe(true);
    const [extra] = await getDb().select().from(reports).where(eq(reports.id, (r as { reportId: string }).reportId));
    expect(extra).toMatchObject({ isUnlocked: true, status: "queued" });
    const jobs = await getDb().execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM pgboss.job WHERE name = 'generate_extra'`);
    expect(jobs.rows[0]!.n).toBe(1);
    expect((await subscriptionStateFor(viewer))?.usedToday).toBe(1);
    expect(await unlockExtraWithSubscription(viewer.userId, main.conversation.id, "quem-gosta-mais")).toMatchObject({ ok: false, reason: "already_unlocked" });
    // Tipo que não é adicional não passa por aqui.
    expect(await unlockExtraWithSubscription(viewer.userId, main.conversation.id, "principal")).toEqual({ ok: false, reason: "not_found" });
  });

  it("reembolso de cobrança da assinatura: revoga e volta a bloquear o que ela liberou (menos o pago à parte)", async () => {
    const { viewer } = await newUser();
    const { sub } = await subscribe(viewer);
    const viaSub = await createReadyMainReport(viewer.userId);
    await unlockWithSubscription(viewer.userId, viaSub.report.id);
    const extra = await unlockExtraWithSubscription(viewer.userId, viaSub.conversation.id, "quem-gosta-mais");
    // Um relatório comprado à parte continua liberado.
    const paidApart = await createReadyMainReport(viewer.userId);
    const purchase = await createPendingPurchase(viewer.userId, paidApart.report.id);
    await post(event("checkout.session.completed", checkoutSession({ client_reference_id: purchase.id, payment_intent: "pi_avulso" })));
    expect(await isUnlocked(paidApart.report.id)).toBe(true);

    const refund = await post(event("charge.refunded", { id: "ch_sub_1", object: "charge", refunded: true, payment_intent: "pi_fatura_assinatura", customer: sub.customer }));
    expect(refund.outcome).toBe("revoked");
    expect(await isUnlocked(viaSub.report.id)).toBe(false);
    expect(await isUnlocked((extra as { reportId: string }).reportId)).toBe(false);
    expect(await isUnlocked(paidApart.report.id)).toBe(true);
    expect(await subscriptionStateFor(viewer)).toMatchObject({ active: false, status: "revoked" });
    const audits = await getDb().select().from(auditLog).where(eq(auditLog.action, "subscription.revoked_refund"));
    expect(audits).toHaveLength(1);
    // A revogação vale também para usos futuros.
    const later = await createReadyMainReport(viewer.userId);
    expect(await unlockWithSubscription(viewer.userId, later.report.id)).toEqual({ ok: false, reason: "no_subscription" });
  });

  it("reembolso de compra avulsa do assinante não mexe na assinatura", async () => {
    const { viewer } = await newUser();
    const { sub } = await subscribe(viewer);
    const main = await createReadyMainReport(viewer.userId);
    const purchase = await createPendingPurchase(viewer.userId, main.report.id);
    await post(event("checkout.session.completed", checkoutSession({ client_reference_id: purchase.id, payment_intent: "pi_avulso_2" })));
    await post(event("charge.refunded", { id: "ch_avulso", object: "charge", refunded: true, payment_intent: "pi_avulso_2", customer: sub.customer }));
    expect(await isUnlocked(main.report.id)).toBe(false);
    expect((await subscriptionStateFor(viewer))?.active).toBe(true);
  });

  it("não deixa assinar de novo com assinatura ativa", async () => {
    const { viewer } = await newUser();
    expect((await startSubscriptionCheckout(viewer)).ok).toBe(true);
    await subscribe(viewer);
    expect(await startSubscriptionCheckout(viewer)).toEqual({ ok: false, error: "already_subscribed" });
  });

  it("reconciliação: sincroniza assinaturas abertas pela API do Stripe (evento perdido)", async () => {
    const { viewer } = await newUser();
    const { sub } = await subscribe(viewer);
    await getDb().update(subscriptions).set({ syncedAt: new Date(Date.now() - 13 * 3_600_000) });
    const result = await syncOpenSubscriptions(async (id) => ({ ...sub, id, status: "canceled" }) as never);
    expect(result).toEqual({ checked: 1, failed: 0 });
    expect(await subscriptionStateFor(viewer)).toMatchObject({ active: false, status: "canceled" });
  });

  it("cancelUserSubscriptions (usado antes de excluir a conta): cancela no Stripe e avisa quando o Stripe falha", async () => {
    const { viewer } = await newUser();
    const { sub } = await subscribe(viewer);
    const failing = await cancelUserSubscriptions(viewer.userId, async () => {
      throw Object.assign(new Error("rede"), { code: "api_connection_error" });
    });
    expect(failing.ok).toBe(false);
    const canceledIds: string[] = [];
    const ok = await cancelUserSubscriptions(viewer.userId, async (id) => canceledIds.push(id));
    expect(ok.ok).toBe(true);
    expect(canceledIds).toEqual([sub.id]);
    const [row] = await getDb().select().from(subscriptions).where(and(eq(subscriptions.userId, viewer.userId)));
    expect(row!.status).toBe("canceled");
  });

  it("eventos no mesmo segundo: o \"incomplete\" da criação não derruba o \"active\" do pagamento", async () => {
    const { viewer } = await newUser();
    const sub = stripeSubscription();
    const second = Math.floor(Date.now() / 1000);
    await post(event("customer.subscription.updated", { ...sub, status: "active" }, undefined, second));
    await post(event("customer.subscription.created", { ...sub, status: "incomplete" }, undefined, second));
    const [row] = await getDb().select().from(subscriptions);
    expect(row!.status).toBe("active");
    // E, se a criação chegou sozinha antes do checkout, o checkout pago promove para "active".
    await getDb().update(subscriptions).set({ status: "incomplete" });
    const purchase = await createPendingSubscriptionPurchase(viewer.userId);
    await post(
      event(
        "checkout.session.completed",
        checkoutSession({ client_reference_id: purchase.id, payment_link: TEST_LINKS.subscription.id, amount_total: SUBSCRIPTION_GROSS, mode: "subscription", payment_intent: null, subscription: sub.id, customer: sub.customer }),
      ),
    );
    expect((await subscriptionStateFor(viewer))?.active).toBe(true);
    // Toda mudança agenda a releitura na API do Stripe.
    expect(await jobs("subscription_sync")).toBeGreaterThan(0);
  });

  it("reembolso da assinatura agenda o cancelamento no Stripe e bloqueia nova assinatura até encerrar", async () => {
    const { viewer } = await newUser();
    const { sub } = await subscribe(viewer);
    await post(event("charge.refunded", { id: "ch_sub_2", object: "charge", refunded: true, payment_intent: "pi_fatura_2", customer: sub.customer }));
    expect(await jobs("subscription_cancel")).toBe(1);
    // Ainda aberta no Stripe: assinar de novo cobraria em dobro.
    expect(await startSubscriptionCheckout(viewer)).toEqual({ ok: false, error: "subscription_pending" });
    await post(event("customer.subscription.deleted", { ...sub, status: "canceled" }, undefined, Math.floor(Date.now() / 1000) + 5));
    expect((await startSubscriptionCheckout(viewer)).ok).toBe(true);
  });

  it("contestação de cobrança da assinatura: agenda a busca do cliente e revoga a assinatura", async () => {
    const { viewer } = await newUser();
    const { sub } = await subscribe(viewer);
    const main = await createReadyMainReport(viewer.userId);
    await unlockWithSubscription(viewer.userId, main.report.id);
    await post(event("charge.dispute.created", { id: "dp_1", object: "dispute", charge: "ch_fatura_3", payment_intent: "pi_fatura_3" }));
    expect(await jobs("subscription_dispute")).toBe(1);
    // O job descobre o cliente da cobrança na API e chama esta função:
    expect(await revokeSubscriptionsForDisputedCharge(sub.customer, "ch_fatura_3")).toEqual({ outcome: "revoked" });
    expect(await isUnlocked(main.report.id)).toBe(false);
    expect(await subscriptionStateFor(viewer)).toMatchObject({ active: false, status: "revoked" });
    expect(await jobs("subscription_cancel")).toBe(1);
  });

  it("assinatura paga sem compra do site ou com conta excluída: cancela no Stripe", async () => {
    await post(event("checkout.session.completed", checkoutSession({ client_reference_id: null, payment_link: TEST_LINKS.subscription.id, mode: "subscription", payment_intent: null, subscription: "sub_orfa" })));
    expect(await jobs("subscription_cancel")).toBe(1);
    const { viewer } = await newUser();
    const purchase = await createPendingSubscriptionPurchase(viewer.userId);
    await getDb().update(purchases).set({ userId: null }).where(eq(purchases.id, purchase.id));
    const r = await post(
      event("checkout.session.completed", checkoutSession({ client_reference_id: purchase.id, payment_link: TEST_LINKS.subscription.id, amount_total: SUBSCRIPTION_GROSS, mode: "subscription", payment_intent: null, subscription: "sub_sem_dono" })),
    );
    expect(r.outcome).toBe("purchase_not_found");
    expect(await jobs("subscription_cancel")).toBe(2);
  });

  it("link avulso pago depois de liberar pela assinatura: cobrança em dobro com alerta, sem marcar como paga", async () => {
    const { viewer } = await newUser();
    await subscribe(viewer);
    const main = await createReadyMainReport(viewer.userId);
    const pending = await createPendingPurchase(viewer.userId, main.report.id);
    await unlockWithSubscription(viewer.userId, main.report.id);
    const r = await post(event("checkout.session.completed", checkoutSession({ client_reference_id: pending.id, payment_intent: "pi_dobro" })));
    expect(r.outcome).toBe("duplicate_payment");
    const [p] = await getDb().select().from(purchases).where(eq(purchases.id, pending.id));
    expect(p!.status).toBe("pending");
    expect(await getDb().select().from(auditLog).where(eq(auditLog.action, "payment.duplicate"))).toHaveLength(1);
    // O reembolso dessa cobrança não bloqueia o relatório liberado pela assinatura.
    await post(event("charge.refunded", { id: "ch_dobro", object: "charge", refunded: true, payment_intent: "pi_dobro", customer: null }));
    expect(await isUnlocked(main.report.id)).toBe(true);
  });

  it("compra de relatório além do limite vale só por 24 h", async () => {
    const { viewer } = await newUser();
    const main = await createReadyMainReport(viewer.userId);
    const p = await createPendingPurchase(viewer.userId, main.report.id, "relatorio-alem-do-limite");
    await getDb().update(purchases).set({ createdAt: new Date(Date.now() - 25 * 3_600_000) }).where(eq(purchases.id, p.id));
    const r = await post(event("checkout.session.completed", checkoutSession({ client_reference_id: p.id, payment_link: TEST_LINKS.overage.id, amount_total: OVERAGE_GROSS })));
    expect(r.outcome).toBe("mismatch");
    expect(await isUnlocked(main.report.id)).toBe(false);
  });

  it("relatório rebloqueado por revogação pode ser liberado de novo por uma assinatura nova", async () => {
    const { viewer } = await newUser();
    const { sub } = await subscribe(viewer);
    const main = await createReadyMainReport(viewer.userId);
    await unlockWithSubscription(viewer.userId, main.report.id);
    await post(event("charge.refunded", { id: "ch_r", object: "charge", refunded: true, payment_intent: "pi_r", customer: sub.customer }));
    await post(event("customer.subscription.deleted", { ...sub, status: "canceled" }, undefined, Math.floor(Date.now() / 1000) + 5));
    await subscribe(viewer, stripeSubscription());
    expect(await unlockWithSubscription(viewer.userId, main.report.id)).toMatchObject({ ok: true });
    expect(await isUnlocked(main.report.id)).toBe(true);
  });

  it("ao liberar pela assinatura, a sessão leve que fez o envio perde o acesso", async () => {
    const owner = await newUser();
    await subscribe(owner.viewer);
    // Alguém enviou a conversa digitando o e-mail do assinante (sessão leve do mesmo usuário).
    const [light] = await getDb()
      .insert(sessions)
      .values({ userId: owner.viewer.userId, tokenHash: `leve-${Math.random()}`, verified: false, expiresAt: new Date(Date.now() + 86_400_000) })
      .returning();
    const main = await createReadyMainReport(owner.viewer.userId, { createdBySessionId: light!.id });
    const lightViewer = { ...owner.viewer, sessionId: light!.id, verified: false };
    expect(await getReportView(main.report.id, lightViewer)).not.toBeNull();
    await unlockWithSubscription(owner.viewer.userId, main.report.id);
    expect(await getReportView(main.report.id, lightViewer)).toBeNull();
    expect((await getReportView(main.report.id, owner.viewer))?.isUnlocked).toBe(true);
  });

  it("a limpeza por inatividade não apaga assinante", async () => {
    const { viewer } = await newUser();
    await subscribe(viewer);
    await getDb().update(users).set({ createdAt: new Date(Date.now() - 60 * 86_400_000) }).where(eq(users.id, viewer.userId));
    await getDb().delete(sessions).where(eq(sessions.userId, viewer.userId));
    await runRetention();
    expect(await getDb().select().from(users).where(eq(users.id, viewer.userId))).toHaveLength(1);
    // Sem assinatura aberta, o mesmo usuário seria apagado.
    await getDb().update(subscriptions).set({ status: "canceled" });
    await runRetention();
    expect(await getDb().select().from(users).where(eq(users.id, viewer.userId))).toHaveLength(0);
  });

  it("preços públicos só anunciam a assinatura com o Payment Link configurado", async () => {
    clearPublicPricesCache();
    expect((await publicPrices()).subscriptionCents).toBe(SUBSCRIPTION_GROSS);
    await getDb().update(reportTypes).set({ stripeTestPaymentLinkId: null, stripeTestPaymentLinkUrl: null }).where(eq(reportTypes.slug, "assinatura-mensal"));
    clearPublicPricesCache();
    const prices = await publicPrices();
    expect(prices.subscriptionCents).toBeNull();
    expect(prices.overageCents).toBeNull();
    clearPublicPricesCache();
  });

  it("assinatura de outro produto da conta Stripe (outro Payment Link) nunca é cancelada daqui", async () => {
    await post(event("checkout.session.completed", checkoutSession({ client_reference_id: null, payment_link: "plink_outro_produto", mode: "subscription", payment_intent: null, subscription: "sub_alheia" })));
    expect(await jobs("subscription_cancel")).toBe(0);
  });

  it("Pix aberto, liberado pela assinatura e o Pix compensando depois: alerta de cobrança em dobro", async () => {
    const { viewer } = await newUser();
    await subscribe(viewer);
    const main = await createReadyMainReport(viewer.userId);
    const pending = await createPendingPurchase(viewer.userId, main.report.id);
    const pix = checkoutSession({ client_reference_id: pending.id, payment_status: "unpaid", payment_method_types: ["pix"], payment_intent: "pi_pix_dobro" });
    expect((await post(event("checkout.session.completed", pix))).outcome).toBe("awaiting_async_payment");
    await unlockWithSubscription(viewer.userId, main.report.id);
    const paid = await post(event("checkout.session.async_payment_succeeded", { ...pix, payment_status: "paid" }));
    expect(paid.outcome).toBe("duplicate_payment");
    const audits = await getDb().select().from(auditLog).where(eq(auditLog.action, "payment.duplicate"));
    expect(audits).toHaveLength(1);
    // Reenvio do mesmo evento não repete o alerta.
    await post(event("checkout.session.async_payment_succeeded", { ...pix, payment_status: "paid" }));
    expect(await getDb().select().from(auditLog).where(eq(auditLog.action, "payment.duplicate"))).toHaveLength(1);
  });

  it("compra além do limite com mais de 24 h: libera se a pessoa ainda for assinante", async () => {
    const { viewer } = await newUser();
    await subscribe(viewer);
    const main = await createReadyMainReport(viewer.userId);
    const p = await createPendingPurchase(viewer.userId, main.report.id, "relatorio-alem-do-limite");
    await getDb().update(purchases).set({ createdAt: new Date(Date.now() - 25 * 3_600_000) }).where(eq(purchases.id, p.id));
    const r = await post(event("checkout.session.completed", checkoutSession({ client_reference_id: p.id, payment_link: TEST_LINKS.overage.id, amount_total: OVERAGE_GROSS })));
    expect(r.outcome).toBe("unlocked");
  });

  it("revogação não agenda cancelamento de assinatura já encerrada", async () => {
    const { viewer } = await newUser();
    const { sub } = await subscribe(viewer);
    await getDb().update(subscriptions).set({ status: "canceled" });
    await post(event("charge.refunded", { id: "ch_fim", object: "charge", refunded: true, payment_intent: "pi_fim", customer: sub.customer }));
    expect(await jobs("subscription_cancel")).toBe(0);
  });
});
