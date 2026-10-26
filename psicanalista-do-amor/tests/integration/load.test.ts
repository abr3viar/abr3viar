import { afterAll, beforeEach, expect, it } from "vitest";
import { z } from "zod";
import { AiClient, type ChatRequest, type ChatResponse, type ChatTransport } from "@/server/ai/client";
import { PostgresRateLimiter } from "@/server/ai/rate-limiter";
import { closeDb } from "@/server/db/client";
import { stopBoss } from "@/server/jobs/boss";
import { describeDb, prepareTestDb } from "../helpers/db";

/**
 * Teste de carga SIMULADO do limitador de tokens (plano.md, Fase 5): vários "workers"
 * (instâncias do AiClient) compartilham o limitador no Postgres e disparam chamadas contra
 * uma Groq falsa com orçamento de tokens por janela, que responde 429 ao estourar.
 * O teste real com a chave da Groq é manual (docs/teste-de-carga.md).
 */

const WINDOW_MS = 1500;
const BUDGET = 6000;
const COMPLETION = 1000;

function fakeGroq() {
  let windowStart = Date.now();
  let used = 0;
  let inFlight = 0;
  const stats = { ok: 0, rateLimited: 0, maxInFlight: 0 };
  const transport: ChatTransport = async (req: ChatRequest): Promise<ChatResponse> => {
    const now = Date.now();
    if (now - windowStart >= WINDOW_MS) {
      windowStart = now;
      used = 0;
    }
    const cost = req.max_completion_tokens + 50;
    const resetS = ((WINDOW_MS - (now - windowStart)) / 1000).toFixed(2);
    if (used + cost > BUDGET) {
      stats.rateLimited++;
      throw Object.assign(new Error("429"), {
        status: 429,
        headers: new Headers({ "retry-after": "1", "x-ratelimit-reset-tokens": `${resetS}s` }),
        error: {},
      });
    }
    used += cost;
    inFlight++;
    stats.maxInFlight = Math.max(stats.maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, 40));
    inFlight--;
    stats.ok++;
    return {
      content: '{"ok":true}',
      finishReason: "stop",
      usage: { promptTokens: 50, completionTokens: 20 },
      model: req.model,
      headers: new Headers({
        "x-ratelimit-remaining-tokens": String(Math.max(0, BUDGET - used)),
        "x-ratelimit-reset-tokens": `${resetS}s`,
        "x-ratelimit-remaining-requests": "1000",
        "x-ratelimit-reset-requests": "60s",
      }),
    };
  };
  return { transport, stats };
}

describeDb("carga simulada: limitador de tokens compartilhado entre workers", () => {
  beforeEach(async () => {
    await prepareTestDb();
  });
  afterAll(async () => {
    await stopBoss();
    await closeDb();
  });

  it("3 workers × 8 chamadas concluem sem estourar a concorrência e com poucos 429", async () => {
    const groq = fakeGroq();
    const limiter = new PostgresRateLimiter();
    const workers = Array.from(
      { length: 3 },
      () => new AiClient({ transport: groq.transport, limiter, concurrency: 2, maxAttempts: 6, sleep: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 1500))) }),
    );
    const schema = z.object({ ok: z.boolean() });
    const started = Date.now();
    const results = await Promise.all(
      workers.flatMap((w) =>
        Array.from({ length: 8 }, () =>
          w.callJson({ purpose: "report", label: "carga", schema, maxCompletionTokens: COMPLETION, messages: [{ role: "user", content: "oi" }] }),
        ),
      ),
    );
    const elapsed = Date.now() - started;

    expect(results).toHaveLength(24);
    expect(results.every((r) => r.data.ok)).toBe(true);
    expect(groq.stats.ok).toBe(24);
    // 2 por worker × 3 workers
    expect(groq.stats.maxInFlight).toBeLessThanOrEqual(6);
    // O limitador evita a "tempestade" de 429: bem menos rejeições do que chamadas.
    expect(groq.stats.rateLimited).toBeLessThan(24);
    // 24 × ~1050 tokens com 6000 por janela de 1,5 s ≈ 5 janelas; folga para o CI.
    expect(elapsed).toBeLessThan(40_000);
    console.info(`[carga] 24 chamadas em ${elapsed} ms; 429 simulados: ${groq.stats.rateLimited}; pico de concorrência: ${groq.stats.maxInFlight}`);
  }, 60_000);
});
