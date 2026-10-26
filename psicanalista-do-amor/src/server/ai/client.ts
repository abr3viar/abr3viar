import "server-only";
import Groq from "groq-sdk";
import type { z } from "zod";
import { getEnv } from "@/env";
import { log, safeErr, SafeError } from "@/server/log";
import { PostgresRateLimiter, parseGroqDuration, type RateLimiter } from "./rate-limiter";

/**
 * ÚNICO ponto de acesso à Groq (CLAUDE.md: "nunca chamar o SDK direto").
 * - Modelos sempre por env (GROQ_VISION_MODEL, GROQ_REPORT_MODEL, GROQ_SUMMARY_MODEL).
 * - `response_format: json_object` + zod tolerante (sem Structured Outputs estrito, D12).
 * - Retries com backoff exponencial + jitter para 429, 5xx, timeout e JSON inválido;
 *   respeita `retry-after` e `x-ratelimit-reset-*`.
 * - Limitador de tokens por modelo (Postgres) + concorrência máxima por processo.
 * - Nada de conteúdo em logs: nem prompt, nem resposta, nem `failed_generation`.
 */

export type AiPurpose = "vision" | "report" | "summary";

export type ChatContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string | ChatContentPart[] }
  | { role: "assistant"; content: string };

export type ChatRequest = {
  model: string;
  messages: ChatMessage[];
  temperature: number;
  max_completion_tokens: number;
  response_format: { type: "json_object" };
  reasoning_effort?: "none" | "default" | "low" | "medium" | "high";
  include_reasoning?: boolean;
};

export type ChatResponse = {
  content: string | null;
  finishReason: string | null;
  usage: { promptTokens: number; completionTokens: number };
  model: string;
  headers: Headers;
};

/** Transporte HTTP (substituível nos testes). */
export type ChatTransport = (req: ChatRequest, signal?: AbortSignal) => Promise<ChatResponse>;

export class AiError extends SafeError {}

export function modelFor(purpose: AiPurpose): string {
  const env = getEnv();
  if (purpose === "vision") return env.GROQ_VISION_MODEL;
  if (purpose === "summary") return env.GROQ_SUMMARY_MODEL;
  return env.GROQ_REPORT_MODEL;
}

/** Estimativa grosseira de tokens para pt-BR (≈ caracteres / 3,5). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}

const IMAGE_TOKENS = 2048;

function estimateRequestTokens(req: ChatRequest): number {
  let total = 0;
  for (const m of req.messages) {
    if (typeof m.content === "string") total += estimateTokens(m.content);
    else
      for (const part of m.content) {
        total += part.type === "text" ? estimateTokens(part.text) : IMAGE_TOKENS;
      }
  }
  return total + req.max_completion_tokens;
}

// ---------------------------------------------------------------- transporte padrão
function groqTransport(): ChatTransport {
  const env = getEnv();
  const client = new Groq({
    apiKey: env.GROQ_API_KEY,
    baseURL: env.GROQ_BASE_URL,
    maxRetries: 0, // retries são nossos (com limitador)
    timeout: 180_000,
  });
  return async (req, signal) => {
    const { data, response } = await client.chat.completions
      .create(
        {
          model: req.model,
          messages: req.messages as Groq.Chat.ChatCompletionMessageParam[],
          temperature: req.temperature,
          max_completion_tokens: req.max_completion_tokens,
          response_format: req.response_format,
          ...(req.reasoning_effort ? { reasoning_effort: req.reasoning_effort } : {}),
          ...(req.include_reasoning !== undefined ? { include_reasoning: req.include_reasoning } : {}),
          stream: false,
        },
        { signal },
      )
      .withResponse();
    const choice = data.choices[0];
    return {
      content: choice?.message?.content ?? null,
      finishReason: choice?.finish_reason ?? null,
      usage: {
        promptTokens: data.usage?.prompt_tokens ?? 0,
        completionTokens: data.usage?.completion_tokens ?? 0,
      },
      model: data.model,
      headers: response.headers,
    };
  };
}

// ---------------------------------------------------------------- concorrência
class Semaphore {
  private active = 0;
  private readonly queue: (() => void)[] = [];
  constructor(private readonly max: number) {}
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) await new Promise<void>((r) => this.queue.push(r));
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      this.queue.shift()?.();
    }
  }
}

// ---------------------------------------------------------------- erros
type Classified = { retry: boolean; code: string; waitMs?: number; blockModel?: boolean };

function headerOf(err: unknown, name: string): string | null {
  const h = (err as { headers?: unknown }).headers;
  if (h && typeof (h as Headers).get === "function") return (h as Headers).get(name);
  return null;
}

export function classifyError(err: unknown): Classified {
  if (err instanceof InvalidOutputError) return { retry: true, code: "ai_invalid_output" };
  const status = (err as { status?: unknown }).status;
  const errorBody = (err as { error?: { error?: { code?: unknown } ; code?: unknown } }).error;
  const apiCode = errorBody?.error?.code ?? errorBody?.code;
  if (status === 429) {
    const retryAfter = headerOf(err, "retry-after");
    const reset =
      parseGroqDuration(retryAfter) ??
      Math.max(
        parseGroqDuration(headerOf(err, "x-ratelimit-reset-tokens")) ?? 0,
        parseGroqDuration(headerOf(err, "x-ratelimit-reset-requests")) ?? 0,
      );
    return { retry: true, code: "ai_rate_limited", waitMs: reset || undefined, blockModel: true };
  }
  if (status === 400 && (apiCode === "json_validate_failed" || apiCode === "output_parse_failed")) {
    return { retry: true, code: "ai_invalid_output" };
  }
  if (typeof status === "number" && status >= 500) return { retry: true, code: "ai_unavailable" };
  if (status === 408 || status === 409) return { retry: true, code: "ai_unavailable" };
  if (typeof status === "number" && status >= 400) {
    return { retry: false, code: status === 401 || status === 403 ? "ai_auth" : status === 404 ? "ai_model_not_found" : "ai_bad_request" };
  }
  // Sem status: timeout / conexão
  const name = (err as { name?: unknown }).name;
  if (name === "AbortError" && (err as { message?: string }).message === "aborted") {
    return { retry: false, code: "ai_aborted" };
  }
  return { retry: true, code: "ai_unavailable" };
}

class InvalidOutputError extends Error {
  constructor(readonly reason: string) {
    super("invalid_output");
    this.name = "InvalidOutputError";
  }
}

/** Extrai o objeto JSON da resposta (tolerando cercas ```json e texto em volta). */
export function extractJson(content: string): unknown {
  const trimmed = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        // Nunca propagar o SyntaxError (a mensagem dele pode trazer trecho da resposta).
        throw new InvalidOutputError("not_json");
      }
    }
    throw new InvalidOutputError("not_json");
  }
}

// ---------------------------------------------------------------- cliente
export type CallJsonOptions<T> = {
  purpose: AiPurpose;
  /** Rótulo curto para logs (ex.: "main_report"). Nunca conteúdo. */
  label: string;
  messages: ChatMessage[];
  schema: z.ZodType<T>;
  maxCompletionTokens: number;
  temperature?: number;
  signal?: AbortSignal;
  /** Máximo de tentativas desta chamada (padrão do cliente: 4). */
  maxAttempts?: number;
  /** Validação extra; lançar `rejectOutput()` faz uma nova tentativa. */
  validate?: (data: T) => void;
  /**
   * Esforço de raciocínio desta chamada (sobrepõe `GROQ_REASONING_EFFORT`).
   * Use "low" em chamadas curtas (gancho, resumo, regeneração de seção): os tokens de
   * raciocínio contam no `max_completion_tokens` e no limite por minuto.
   * Ignorado se a env for "off" ou na visão.
   */
  reasoningEffort?: "low" | "medium" | "high";
};

/** Teto do `max_completion_tokens` ao refazer uma resposta truncada. */
export const TRUNCATION_RETRY_MAX_TOKENS = 16_000;

/** Nova tentativa depois de `finish_reason: length`: ×1,5, com teto (nunca reduz). */
export function grownCompletionTokens(current: number): number {
  return Math.max(current, Math.min(TRUNCATION_RETRY_MAX_TOKENS, Math.ceil(current * 1.5)));
}

export type CallJsonResult<T> = {
  data: T;
  model: string;
  tokensIn: number;
  tokensOut: number;
  attempts: number;
};

export function rejectOutput(reason: string): never {
  throw new InvalidOutputError(reason);
}

export type AiClientDeps = {
  transport?: ChatTransport;
  limiter?: RateLimiter;
  sleep?: (ms: number) => Promise<void>;
  maxAttempts?: number;
  concurrency?: number;
};

export class AiClient {
  private readonly transport: ChatTransport;
  private readonly limiter: RateLimiter;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly maxAttempts: number;
  private readonly semaphore: Semaphore;

  constructor(deps: AiClientDeps = {}) {
    this.transport = deps.transport ?? groqTransport();
    this.limiter = deps.limiter ?? new PostgresRateLimiter();
    this.sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.maxAttempts = deps.maxAttempts ?? 4;
    this.semaphore = new Semaphore(deps.concurrency ?? getEnv().GROQ_MAX_CONCURRENCY);
  }

  async callJson<T>(opts: CallJsonOptions<T>): Promise<CallJsonResult<T>> {
    const env = getEnv();
    const model = modelFor(opts.purpose);
    const effort = env.GROQ_REASONING_EFFORT;
    const req: ChatRequest = {
      model,
      messages: opts.messages,
      temperature: opts.temperature ?? 0.7,
      max_completion_tokens: opts.maxCompletionTokens,
      response_format: { type: "json_object" },
      ...(opts.purpose !== "vision" && effort !== "off"
        ? { reasoning_effort: opts.reasoningEffort ?? effort, include_reasoning: false }
        : {}),
    };
    let tokensIn = 0;
    let tokensOut = 0;
    let lastCode = "ai_unavailable";
    let maxTokens = req.max_completion_tokens;

    const maxAttempts = Math.max(1, Math.min(opts.maxAttempts ?? this.maxAttempts, this.maxAttempts));
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const started = Date.now();
      const attemptReq: ChatRequest = { ...req, max_completion_tokens: maxTokens };
      const estimated = estimateRequestTokens(attemptReq);
      try {
        const res = await this.semaphore.run(async () => {
          await this.limiter.acquire(model, estimated, opts.signal);
          return this.transport(attemptReq, opts.signal);
        });
        await this.limiter.update(model, res.headers).catch(() => undefined);
        tokensIn += res.usage.promptTokens;
        tokensOut += res.usage.completionTokens;
        if (!res.content) throw new InvalidOutputError(res.finishReason === "length" ? "truncated" : "empty");
        if (res.finishReason === "length") throw new InvalidOutputError("truncated");
        const raw = extractJson(res.content);
        const parsed = opts.schema.safeParse(raw);
        if (!parsed.success) throw new InvalidOutputError("schema");
        opts.validate?.(parsed.data);
        log.info(
          {
            label: opts.label,
            model,
            attempt,
            ms: Date.now() - started,
            tokensIn: res.usage.promptTokens,
            tokensOut: res.usage.completionTokens,
          },
          "ai_call_ok",
        );
        return { data: parsed.data, model: res.model || model, tokensIn, tokensOut, attempts: attempt };
      } catch (err) {
        const c = classifyError(err);
        lastCode = c.code;
        log.warn(
          {
            label: opts.label,
            model,
            attempt,
            ms: Date.now() - started,
            code: c.code,
            reason: err instanceof InvalidOutputError ? err.reason : undefined,
            err: safeErr(err),
          },
          "ai_call_failed",
        );
        if (!c.retry || attempt === maxAttempts) break;
        // Truncada: o orçamento não bastou (raciocínio conta nele). Pede mais na próxima.
        if (err instanceof InvalidOutputError && err.reason === "truncated") {
          maxTokens = grownCompletionTokens(maxTokens);
        }
        const backoff = Math.min(30_000, 1000 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 500);
        const wait = Math.max(backoff, c.waitMs ?? 0);
        if (c.blockModel) await this.limiter.block(model, Date.now() + wait).catch(() => undefined);
        await this.sleep(Math.min(wait, 120_000));
      }
    }
    throw new AiError(lastCode);
  }
}

const holder = globalThis as unknown as { __pdaAi?: AiClient };

export function getAiClient(): AiClient {
  holder.__pdaAi ??= new AiClient();
  return holder.__pdaAi;
}

/** Só para testes. */
export function setAiClientForTests(client: AiClient | undefined): void {
  holder.__pdaAi = client;
}
