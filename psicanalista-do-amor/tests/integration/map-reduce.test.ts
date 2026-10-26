import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, expect, it } from "vitest";
import { AiClient, setAiClientForTests, type ChatTransport } from "@/server/ai/client";
import { NoopRateLimiter } from "@/server/ai/rate-limiter";
import { resetEnvCache } from "@/env";
import { closeDb, getDb } from "@/server/db/client";
import { conversationDigests, conversations } from "@/server/db/schema";
import { stopBoss } from "@/server/jobs/boss";
import { buildAnalysisContext, type AiMessage } from "@/server/reports/context";
import { computeStats } from "@/server/reports/stats";
import { describeDb, prepareTestDb } from "../helpers/db";
import { createUserWithSession } from "../helpers/factories";

describeDb("map-reduce com notas cifradas reaproveitáveis", () => {
  beforeEach(async () => {
    await prepareTestDb();
    process.env.REPORT_DIRECT_MAX_TOKENS = "2000";
    process.env.CHUNK_TOKENS = "800";
    resetEnvCache();
  });
  afterEach(() => {
    delete process.env.REPORT_DIRECT_MAX_TOKENS;
    delete process.env.CHUNK_TOKENS;
    resetEnvCache();
    setAiClientForTests(undefined);
  });
  afterAll(async () => {
    await stopBoss();
    await closeDb();
  });

  it("resume em blocos, grava as notas cifradas e reaproveita na segunda vez", async () => {
    const { user } = await createUserWithSession("mr@example.com");
    const [conv] = await getDb()
      .insert(conversations)
      .values({ userId: user.id, sourceType: "paste", status: "generating", hasTimestamps: true, expiresAt: new Date(Date.now() + 86_400_000) })
      .returning();
    const messages: AiMessage[] = Array.from({ length: 600 }, (_, i) => ({
      seq: i + 1,
      sender: i % 2 ? "b" : "a",
      sentAt: new Date(Date.UTC(2026, 8, 1, 12, i)),
      kind: "text",
      content: `mensagem número ${i + 1} com algum texto SEGREDO-NAS-NOTAS`,
    }));
    let calls = 0;
    const transport: ChatTransport = async (req) => {
      calls++;
      return {
        content: JSON.stringify({ period: "x", themes: ["SEGREDO-NAS-NOTAS"], moments: [{ seq: 1, quote: "oi", why: "x" }] }),
        finishReason: "stop",
        usage: { promptTokens: 1, completionTokens: 1 },
        model: req.model,
        headers: new Headers(),
      };
    };
    setAiClientForTests(new AiClient({ transport, limiter: new NoopRateLimiter(), sleep: async () => {} }));
    const loaded = {
      conversation: conv!,
      names: { a: "Ana", b: "Lucas" },
      userIs: "none" as const,
      messages,
      stats: computeStats(messages, { timeZone: "America/Sao_Paulo", hasTimestamps: true }),
    };
    const ctx = await buildAnalysisContext(loaded);
    expect(ctx.mode).toBe("mapreduce");
    expect(ctx.text).toContain("<notas>");
    expect(ctx.text).toContain("#600");
    const firstCalls = calls;
    expect(firstCalls).toBeGreaterThan(3);

    const digests = await getDb().select().from(conversationDigests).where(eq(conversationDigests.conversationId, conv!.id));
    expect(digests.length).toBeGreaterThan(3);
    expect(digests.every((d) => d.content.startsWith("v1:") && !d.content.includes("SEGREDO"))).toBe(true);

    calls = 0;
    await buildAnalysisContext(loaded);
    // Só os merges hierárquicos (se houver) são refeitos; os blocos vêm do cache.
    expect(calls).toBeLessThan(firstCalls - digests.length + 1);
  });
});
