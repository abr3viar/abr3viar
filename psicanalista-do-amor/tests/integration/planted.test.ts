import { eq } from "drizzle-orm";
import { afterAll, beforeEach, expect, it, vi } from "vitest";
import { getOwnedConversation, sentWithoutLogin } from "@/server/access";
import { closeDb, getDb } from "@/server/db/client";
import { conversations, sessions } from "@/server/db/schema";
import { stopBoss } from "@/server/jobs/boss";
import { startCheckout } from "@/server/payments/start-checkout";
import { describeDb, prepareTestDb } from "../helpers/db";
import { configureTestLinks, createReadyMainReport, createUserWithSession } from "../helpers/factories";

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "203.0.113.20" }),
  cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }),
}));

/** S-03: análise enviada com o e-mail de outra pessoa, por uma sessão sem login. */
describeDb("análise plantada (S-03)", () => {
  beforeEach(async () => {
    await prepareTestDb();
    await configureTestLinks();
  });
  afterAll(async () => {
    await stopBoss();
    await closeDb();
  });

  async function plant() {
    const owner = await createUserWithSession(`dono${Math.random()}@example.com`, true);
    const [light] = await getDb()
      .insert(sessions)
      .values({ userId: owner.viewer.userId, tokenHash: `leve-${Math.random()}`, verified: false, expiresAt: new Date(Date.now() + 86_400_000) })
      .returning();
    const main = await createReadyMainReport(owner.viewer.userId, { createdBySessionId: light!.id });
    return { owner, light: { ...owner.viewer, sessionId: light!.id, verified: false }, main };
  }

  it("o dono logado vê o aviso; a própria sessão do envio, não", async () => {
    const { owner, light, main } = await plant();
    expect((await sentWithoutLogin(owner.viewer, [main.conversation])).has(main.conversation.id)).toBe(true);
    expect((await sentWithoutLogin(light, [main.conversation])).size).toBe(0);
    // Enviada pela própria sessão verificada: sem aviso.
    const mine = await createReadyMainReport(owner.viewer.userId, { createdBySessionId: owner.viewer.sessionId });
    expect((await sentWithoutLogin(owner.viewer, [mine.conversation])).size).toBe(0);
  });

  it("comprar logado corta o acesso da sessão sem login de outro aparelho", async () => {
    const { owner, light, main } = await plant();
    expect(await getOwnedConversation(main.conversation.id, light)).not.toBeNull();
    expect((await startCheckout(owner.viewer, main.conversation.id, "principal")).ok).toBe(true);
    expect(await getOwnedConversation(main.conversation.id, light)).toBeNull();
    expect(await getOwnedConversation(main.conversation.id, owner.viewer)).not.toBeNull();
  });

  it("quem envia e compra no mesmo aparelho sem login continua com acesso", async () => {
    const { light, main } = await plant();
    expect((await startCheckout(light, main.conversation.id, "principal")).ok).toBe(true);
    expect(await getOwnedConversation(main.conversation.id, light)).not.toBeNull();
    const [c] = await getDb().select().from(conversations).where(eq(conversations.id, main.conversation.id));
    expect(c!.createdBySessionId).toBe(light.sessionId);
  });
});
