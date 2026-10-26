import "server-only";
import { eq, sql } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { aiRateState } from "@/server/db/schema";
import { log } from "@/server/log";

/**
 * Limitador de tokens por modelo, com estado no Postgres (plano.md 5.2).
 * Lê os cabeçalhos `x-ratelimit-*` da Groq e evita disparar requisições que vão
 * bater no limite. Compartilhado entre processos/instâncias do worker.
 */

export interface RateLimiter {
  acquire(model: string, tokens: number, signal?: AbortSignal): Promise<void>;
  update(model: string, headers: Headers): Promise<void>;
  block(model: string, untilMs: number): Promise<void>;
}

/** "7.66s", "2m59.56s", "1h2m3s", "120ms" → milissegundos. */
export function parseGroqDuration(value: string | null | undefined): number | null {
  if (!value) return null;
  const v = value.trim();
  if (/^\d+(\.\d+)?$/.test(v)) return Math.round(Number(v) * 1000);
  const re = /(\d+(?:\.\d+)?)(ms|h|m|s)/g;
  let total = 0;
  let found = false;
  for (const m of v.matchAll(re)) {
    found = true;
    const n = Number(m[1]);
    const unit = m[2];
    total += unit === "h" ? n * 3_600_000 : unit === "m" ? n * 60_000 : unit === "s" ? n * 1000 : n;
  }
  return found ? Math.round(total) : null;
}

const MAX_SINGLE_WAIT_MS = 60_000;
const MAX_TOTAL_WAIT_MS = 5 * 60_000;

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new Error("aborted"));
    });
  });

export class PostgresRateLimiter implements RateLimiter {
  async acquire(model: string, tokens: number, signal?: AbortSignal): Promise<void> {
    const db = getDb();
    const started = Date.now();
    for (;;) {
      const [row] = await db.select().from(aiRateState).where(eq(aiRateState.model, model));
      const now = Date.now();
      let waitMs = 0;
      if (row?.blockedUntil && row.blockedUntil.getTime() > now) {
        waitMs = row.blockedUntil.getTime() - now;
      } else if (
        row?.remainingTokens !== null &&
        row?.remainingTokens !== undefined &&
        row.resetTokensAt &&
        row.resetTokensAt.getTime() > now &&
        row.remainingTokens < tokens
      ) {
        waitMs = row.resetTokensAt.getTime() - now;
      } else if (
        row?.remainingRequests !== null &&
        row?.remainingRequests !== undefined &&
        row.remainingRequests <= 0 &&
        row.resetRequestsAt &&
        row.resetRequestsAt.getTime() > now
      ) {
        waitMs = row.resetRequestsAt.getTime() - now;
      }
      if (waitMs <= 0 || Date.now() - started > MAX_TOTAL_WAIT_MS) break;
      log.info({ model, waitMs: Math.min(waitMs, MAX_SINGLE_WAIT_MS) }, "ai_rate_limit_wait");
      await sleep(Math.min(waitMs + 50, MAX_SINGLE_WAIT_MS), signal);
    }
    // Reserva otimista: outros workers enxergam o consumo antes da resposta chegar.
    await db
      .insert(aiRateState)
      .values({ model })
      .onConflictDoUpdate({
        target: aiRateState.model,
        set: {
          remainingTokens: sql`CASE WHEN ${aiRateState.remainingTokens} IS NULL THEN NULL ELSE ${aiRateState.remainingTokens} - ${tokens} END`,
          remainingRequests: sql`CASE WHEN ${aiRateState.remainingRequests} IS NULL THEN NULL ELSE ${aiRateState.remainingRequests} - 1 END`,
        },
      });
  }

  async update(model: string, headers: Headers): Promise<void> {
    const remainingTokens = Number(headers.get("x-ratelimit-remaining-tokens"));
    const remainingRequests = Number(headers.get("x-ratelimit-remaining-requests"));
    const resetTokens = parseGroqDuration(headers.get("x-ratelimit-reset-tokens"));
    const resetRequests = parseGroqDuration(headers.get("x-ratelimit-reset-requests"));
    const now = Date.now();
    const values = {
      model,
      remainingTokens: Number.isFinite(remainingTokens) && headers.has("x-ratelimit-remaining-tokens") ? remainingTokens : null,
      remainingRequests:
        Number.isFinite(remainingRequests) && headers.has("x-ratelimit-remaining-requests") ? remainingRequests : null,
      resetTokensAt: resetTokens !== null ? new Date(now + resetTokens) : null,
      resetRequestsAt: resetRequests !== null ? new Date(now + resetRequests) : null,
    };
    await getDb()
      .insert(aiRateState)
      .values(values)
      .onConflictDoUpdate({ target: aiRateState.model, set: values });
  }

  async block(model: string, untilMs: number): Promise<void> {
    const blockedUntil = new Date(untilMs);
    await getDb()
      .insert(aiRateState)
      .values({ model, blockedUntil })
      .onConflictDoUpdate({ target: aiRateState.model, set: { blockedUntil } });
  }
}

/** Limitador em memória (testes). */
export class NoopRateLimiter implements RateLimiter {
  async acquire(): Promise<void> {}
  async update(): Promise<void> {}
  async block(): Promise<void> {}
}
