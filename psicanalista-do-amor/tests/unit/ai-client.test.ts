import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AiClient, AiError, extractJson, grownCompletionTokens, rejectOutput, type ChatRequest, type ChatResponse, type ChatTransport } from "@/server/ai/client";
import { NoopRateLimiter, parseGroqDuration } from "@/server/ai/rate-limiter";

const schema = z.object({ ok: z.boolean().catch(false), n: z.number().catch(0) });

function ok(content: string, extra: Partial<ChatResponse> = {}): ChatResponse {
  return { content, finishReason: "stop", usage: { promptTokens: 10, completionTokens: 5 }, model: "test/report-model", headers: new Headers(), ...extra };
}

function apiError(status: number, headers: Record<string, string> = {}, body: unknown = {}) {
  return Object.assign(new Error(`api error ${status}: conteúdo sensível`), { status, headers: new Headers(headers), error: body });
}

function client(transport: ChatTransport, sleeps: number[] = []) {
  return new AiClient({
    transport,
    limiter: new NoopRateLimiter(),
    sleep: async (ms) => void sleeps.push(ms),
    concurrency: 2,
  });
}

const call = (c: AiClient, extra = {}) =>
  c.callJson({ purpose: "report", label: "teste", schema, maxCompletionTokens: 100, messages: [{ role: "user", content: "oi" }], ...extra });

describe("cliente Groq", () => {
  it("usa o modelo da env, json_object e parâmetros de raciocínio", async () => {
    const seen: ChatRequest[] = [];
    const c = client(async (req) => {
      seen.push(req);
      return ok('{"ok": true, "n": 2}');
    });
    const res = await call(c);
    expect(res.data).toEqual({ ok: true, n: 2 });
    expect(seen[0]!.model).toBe(process.env.GROQ_REPORT_MODEL);
    expect(seen[0]!.response_format).toEqual({ type: "json_object" });
    expect(seen[0]!.include_reasoning).toBe(false);
    expect(seen[0]!.reasoning_effort).toBe("medium");
  });

  it("visão não envia parâmetros de raciocínio e usa GROQ_VISION_MODEL", async () => {
    const seen: ChatRequest[] = [];
    const c = client(async (req) => (seen.push(req), ok('{"ok":true}')));
    await call(c, { purpose: "vision" });
    expect(seen[0]!.model).toBe(process.env.GROQ_VISION_MODEL);
    expect(seen[0]!.reasoning_effort).toBeUndefined();
  });

  it("refaz em 429 respeitando retry-after, e em 5xx", async () => {
    const sleeps: number[] = [];
    const fn = vi
      .fn<ChatTransport>()
      .mockRejectedValueOnce(apiError(429, { "retry-after": "7" }))
      .mockRejectedValueOnce(apiError(503))
      .mockResolvedValueOnce(ok('{"ok":true}'));
    const res = await call(client(fn, sleeps));
    expect(res.attempts).toBe(3);
    expect(sleeps[0]).toBeGreaterThanOrEqual(7000);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("refaz em JSON inválido, resposta truncada e json_validate_failed", async () => {
    const fn = vi
      .fn<ChatTransport>()
      .mockResolvedValueOnce(ok("isso não é json"))
      .mockResolvedValueOnce(ok('{"ok": tr', { finishReason: "length" }))
      .mockRejectedValueOnce(apiError(400, {}, { error: { code: "json_validate_failed", failed_generation: "texto sensível" } }))
      .mockResolvedValueOnce(ok('```json\n{"ok":true,"n":1}\n```'));
    const res = await call(client(fn));
    expect(res.data.n).toBe(1);
    expect(res.attempts).toBe(4);
  });

  it("desiste após 4 tentativas com código genérico (sem conteúdo na mensagem)", async () => {
    const fn = vi.fn<ChatTransport>().mockRejectedValue(apiError(500));
    const err = await call(client(fn)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AiError);
    expect((err as AiError).code).toBe("ai_unavailable");
    expect((err as Error).message).not.toContain("sensível");
    expect(fn).toHaveBeenCalledTimes(4);
  });

  it("não refaz erro de autenticação/requisição inválida", async () => {
    const fn = vi.fn<ChatTransport>().mockRejectedValue(apiError(401));
    const err = (await call(client(fn)).catch((e: unknown) => e)) as AiError;
    expect(err.code).toBe("ai_auth");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("validação extra pode rejeitar e provocar nova tentativa", async () => {
    let n = 0;
    const fn: ChatTransport = async () => ok(`{"ok":true,"n":${++n}}`);
    const res = await call(client(fn), {
      validate: (d: { n: number }) => {
        if (d.n < 2) rejectOutput("too_small");
      },
    });
    expect(res.data.n).toBe(2);
    expect(res.attempts).toBe(2);
  });

  it("limita a concorrência", async () => {
    let active = 0;
    let max = 0;
    const fn: ChatTransport = async () => {
      active++;
      max = Math.max(max, active);
      await new Promise((r) => setTimeout(r, 20));
      active--;
      return ok('{"ok":true}');
    };
    const c = client(fn);
    await Promise.all(Array.from({ length: 6 }, () => call(c)));
    expect(max).toBe(2);
  });

  it("extractJson e parseGroqDuration", () => {
    expect(extractJson('texto {"a":1} fim')).toEqual({ a: 1 });
    expect(parseGroqDuration("7.66s")).toBe(7660);
    expect(parseGroqDuration("2m59.56s")).toBe(179560);
    expect(parseGroqDuration("120ms")).toBe(120);
    expect(parseGroqDuration("3")).toBe(3000);
    expect(parseGroqDuration(null)).toBeNull();
  });

  it("reasoningEffort por chamada sobrepõe a env (e nunca vai para a visão)", async () => {
    const seen: ChatRequest[] = [];
    const c = client(async (req) => (seen.push(req), ok('{"ok":true}')));
    await call(c, { reasoningEffort: "low" });
    await call(c);
    await call(c, { purpose: "vision", reasoningEffort: "low" });
    expect(seen.map((r) => r.reasoning_effort)).toEqual(["low", "medium", undefined]);
    expect(seen[0]!.include_reasoning).toBe(false);
  });

  it("resposta truncada (finish_reason length): a nova tentativa pede ×1,5 tokens, com teto de 16k", async () => {
    const asked: number[] = [];
    const fn: ChatTransport = async (req) => {
      asked.push(req.max_completion_tokens);
      return asked.length < 3 ? ok('{"ok": tr', { finishReason: "length" }) : ok('{"ok":true}');
    };
    const res = await call(client(fn), { maxCompletionTokens: 4000 });
    expect(res.data.ok).toBe(true);
    expect(asked).toEqual([4000, 6000, 9000]);
    // Erro que não é truncamento não aumenta o pedido.
    const asked2: number[] = [];
    let n = 0;
    await call(
      client(async (req) => (asked2.push(req.max_completion_tokens), ++n === 1 ? ok("não é json") : ok('{"ok":true}'))),
      { maxCompletionTokens: 4000 },
    );
    expect(asked2).toEqual([4000, 4000]);
    expect(grownCompletionTokens(12_000)).toBe(16_000);
    expect(grownCompletionTokens(16_000)).toBe(16_000);
    expect(grownCompletionTokens(20_000)).toBe(20_000);
  });

  it("JSON quebrado mesmo depois de recortar as chaves vira erro de saída inválida (sem SyntaxError com conteúdo)", async () => {
    let err: unknown;
    try {
      extractJson('texto {"a": 1, conteúdo sensível} fim');
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).name).toBe("InvalidOutputError");
    expect((err as Error).message).not.toContain("sensível");
    const fn = vi
      .fn<ChatTransport>()
      .mockResolvedValueOnce(ok('antes {"ok": tru, x} depois'))
      .mockResolvedValueOnce(ok('{"ok":true}'));
    const res = await call(client(fn));
    expect(res.attempts).toBe(2);
  });
});
