import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, expect, it } from "vitest";
import type Stripe from "stripe";
import { resetEnvCache } from "@/env";
import { exportUserData } from "@/server/account-export";
import { decryptField, encryptField } from "@/server/crypto";
import { closeDb, getDb } from "@/server/db/client";
import { conversations, messages, purchases, reportSections, reports, sessions, users } from "@/server/db/schema";
import { deleteUserData } from "@/server/data-deletion";
import { stopBoss } from "@/server/jobs/boss";
import { runRetention } from "@/server/maintenance/retention";
import { reconcilePayments } from "@/server/maintenance/reconcile";
import { rotateEncryptionKey } from "@/server/maintenance/rotate-key";
import { processStripeEvent } from "@/server/payments/fulfill";
import { setStorageForTests } from "@/server/storage";
import { describeDb, prepareTestDb } from "../helpers/db";
import { configureTestLinks, createPendingPurchase, createReadyMainReport, createUserWithSession, SECRET } from "../helpers/factories";
import { checkoutSession, event } from "../helpers/stripe-events";
import { MemoryStorage } from "../helpers/memory-storage";

const KEY_A = Buffer.alloc(32, 7).toString("base64");
const KEY_B = Buffer.alloc(32, 11).toString("base64");

async function jobs(name: string) {
  const r = await getDb().execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM pgboss.job WHERE name = ${name}`);
  return r.rows[0]!.n;
}

describeDb("conta, retenção, rotação de chave e reconciliação", () => {
  beforeEach(async () => {
    await prepareTestDb();
    await configureTestLinks();
    setStorageForTests(new MemoryStorage());
  });
  afterEach(() => {
    process.env.DATA_ENCRYPTION_KEY = KEY_A;
    delete process.env.DATA_ENCRYPTION_KEY_PREVIOUS;
    resetEnvCache();
  });
  afterAll(async () => {
    setStorageForTests(undefined);
    await stopBoss();
    await closeDb();
  });

  it("retenção: apaga vencidas, mantém as válidas e avisa 7 dias antes só as pagas", async () => {
    const { user } = await createUserWithSession("ret@example.com");
    const db = getDb();
    const expired = await createReadyMainReport(user.id);
    const valid = await createReadyMainReport(user.id);
    const paidSoon = await createReadyMainReport(user.id);
    const unpaidSoon = await createReadyMainReport(user.id);
    const day = 86_400_000;
    await db.update(conversations).set({ expiresAt: new Date(Date.now() - day) }).where(eq(conversations.id, expired.conversation.id));
    await db.update(conversations).set({ expiresAt: new Date(Date.now() + 30 * day) }).where(eq(conversations.id, valid.conversation.id));
    await db.update(conversations).set({ expiresAt: new Date(Date.now() + 3 * day) }).where(eq(conversations.id, paidSoon.conversation.id));
    await db.update(conversations).set({ expiresAt: new Date(Date.now() + 3 * day) }).where(eq(conversations.id, unpaidSoon.conversation.id));
    const p = await createPendingPurchase(user.id, paidSoon.report.id);
    await processStripeEvent(event("checkout.session.completed", checkoutSession({ client_reference_id: p.id })));
    // a liberação estende a retenção; força de novo para "vence em 3 dias"
    await db.update(conversations).set({ expiresAt: new Date(Date.now() + 3 * day) }).where(eq(conversations.id, paidSoon.conversation.id));

    const res = await runRetention();
    expect(res.deleted).toBe(1);
    expect(res.warned).toBe(1);
    const left = (await db.select({ id: conversations.id }).from(conversations)).map((c) => c.id);
    expect(left).not.toContain(expired.conversation.id);
    expect(await db.select().from(reports).where(eq(reports.conversationId, expired.conversation.id))).toHaveLength(0);
    expect(await jobs("send_email")).toBeGreaterThanOrEqual(2); // report_unlocked + retention_warning
    // segunda execução não avisa de novo
    expect((await runRetention()).warned).toBe(0);
    // a compra fica (sem conteúdo)
    expect((await db.select().from(purchases).where(eq(purchases.id, p.id))).length).toBe(1);
  });

  it("retenção apaga e-mails sem análises nem sessão válida depois do prazo (minimização)", async () => {
    const db = getDb();
    const old = new Date(Date.now() - 30 * 86_400_000);
    const idle = await createUserWithSession("ocioso@example.com");
    await db.update(sessions).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(sessions.userId, idle.user.id));
    await db.update(users).set({ createdAt: old }).where(eq(users.id, idle.user.id));
    const logged = await createUserWithSession("com-sessao@example.com");
    await db.update(users).set({ createdAt: old }).where(eq(users.id, logged.user.id));
    const withConv = await createUserWithSession("com-analise@example.com");
    await createReadyMainReport(withConv.user.id);
    await db.update(sessions).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(sessions.userId, withConv.user.id));
    await db.update(users).set({ createdAt: old }).where(eq(users.id, withConv.user.id));
    const fresh = await createUserWithSession("novo@example.com");
    await db.update(sessions).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(sessions.userId, fresh.user.id));

    const res = await runRetention();
    expect(res.usersPurged).toBe(1);
    const emails = (await db.select({ e: users.email }).from(users)).map((u) => u.e);
    expect(emails).not.toContain("ocioso@example.com");
    expect(emails).toEqual(expect.arrayContaining(["com-sessao@example.com", "com-analise@example.com", "novo@example.com"]));
  });

  it("rotação de chave re-cifra tudo e a chave antiga deixa de ser necessária", async () => {
    const { user } = await createUserWithSession("rot@example.com");
    const { report, conversation } = await createReadyMainReport(user.id);
    await getDb().insert(messages).values({ conversationId: conversation.id, seq: 1, sender: "a", kind: "text", content: encryptField("mensagem antiga"), source: "text", senderRaw: encryptField("Ana") });

    process.env.DATA_ENCRYPTION_KEY = KEY_B;
    process.env.DATA_ENCRYPTION_KEY_PREVIOUS = KEY_A;
    resetEnvCache();
    const { updated } = await rotateEncryptionKey();
    expect(updated).toBeGreaterThanOrEqual(10);
    expect((await rotateEncryptionKey()).updated).toBe(0); // idempotente

    delete process.env.DATA_ENCRYPTION_KEY_PREVIOUS;
    resetEnvCache();
    const [m] = await getDb().select().from(messages).where(eq(messages.conversationId, conversation.id));
    expect(decryptField(m!.content)).toBe("mensagem antiga");
    const secs = await getDb().select().from(reportSections).where(eq(reportSections.reportId, report.id));
    expect(secs.every((s) => decryptField(s.content).length > 0)).toBe(true);
    const [c] = await getDb().select().from(conversations).where(eq(conversations.id, conversation.id));
    expect(decryptField(c!.participantAName!)).toBe("Ana");
  });

  it("reconciliação libera pagamento cujo webhook não chegou (mesmas conferências)", async () => {
    const { user } = await createUserWithSession("rec@example.com");
    const { report } = await createReadyMainReport(user.id);
    const p = await createPendingPurchase(user.id, report.id);
    const bad = await createPendingPurchase(user.id, (await createReadyMainReport(user.id)).report.id);
    const sessions = [
      checkoutSession({ client_reference_id: p.id }),
      checkoutSession({ client_reference_id: bad.id, amount_total: 100 }),
      checkoutSession({ client_reference_id: null }),
    ] as unknown as Stripe.Checkout.Session[];
    const lister = async function* () {
      for (const s of sessions) yield s;
    };
    const res = await reconcilePayments(lister, async () => false);
    expect(res.unlocked).toBe(1);
    const [r] = await getDb().select().from(reports).where(eq(reports.id, report.id));
    expect(r!.isUnlocked).toBe(true);
    const [b] = await getDb().select().from(purchases).where(eq(purchases.id, bad.id));
    expect(b!.status).toBe("pending");
  });

  it("reconciliação NÃO libera pagamento já reembolsado/contestado (webhooks perdidos)", async () => {
    const { user } = await createUserWithSession("rec2@example.com");
    const { report } = await createReadyMainReport(user.id);
    const p = await createPendingPurchase(user.id, report.id);
    const sessions = [checkoutSession({ client_reference_id: p.id, payment_intent: "pi_devolvido" })] as unknown as Stripe.Checkout.Session[];
    const lister = async function* () {
      for (const s of sessions) yield s;
    };
    const res = await reconcilePayments(lister, async (pi) => pi === "pi_devolvido");
    expect(res.unlocked).toBe(0);
    const [r] = await getDb().select().from(reports).where(eq(reports.id, report.id));
    expect(r!.isUnlocked).toBe(false);
  });

  it("exportação traz os dados decifrados do titular; exclusão total apaga tudo e mantém compras sem vínculo", async () => {
    const { user } = await createUserWithSession("exp@example.com");
    const other = await createUserWithSession("outra@example.com");
    const mine = await createReadyMainReport(user.id);
    await createReadyMainReport(other.user.id);
    const p = await createPendingPurchase(user.id, mine.report.id);
    await processStripeEvent(event("checkout.session.completed", checkoutSession({ client_reference_id: p.id })));

    const data = await exportUserData(user.id);
    expect(data!.user.email).toBe("exp@example.com");
    expect(data!.conversations).toHaveLength(1);
    expect(data!.conversations[0]!.participants.a).toBe("Ana");
    expect(JSON.stringify(data)).toContain(`${SECRET}-conteudo-virada`);
    expect(JSON.stringify(data)).not.toContain("outra@example.com");

    await deleteUserData(user.id);
    expect(await getDb().select().from(users).where(eq(users.id, user.id))).toHaveLength(0);
    expect(await getDb().select().from(conversations).where(eq(conversations.userId, user.id))).toHaveLength(0);
    const [kept] = await getDb().select().from(purchases).where(eq(purchases.id, p.id));
    expect(kept!.status).toBe("paid");
    expect(kept!.userId).toBeNull();
    expect(kept!.reportId).toBeNull();
    expect(await getDb().select().from(conversations).where(eq(conversations.userId, other.user.id))).toHaveLength(1);
  });
});
