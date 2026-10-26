import "server-only";
import { headers } from "next/headers";
import { getEnv } from "@/env";

/**
 * IP do cliente para rate limit. O proxy da hospedagem ACRESCENTA o IP real ao final de
 * X-Forwarded-For; entradas anteriores podem ter sido forjadas pelo cliente. Por isso
 * usamos a entrada a `TRUSTED_PROXY_HOPS` posições do fim (padrão 1).
 */
export function clientIpFromForwarded(xff: string | null, hops: number): string | null {
  if (!xff) return null;
  const list = xff.split(",").map((s) => s.trim()).filter(Boolean);
  if (list.length === 0) return null;
  return list[Math.max(0, list.length - Math.max(1, hops))] ?? null;
}

export async function getClientIp(): Promise<string> {
  const h = await headers();
  const hops = getEnv().TRUSTED_PROXY_HOPS;
  return clientIpFromForwarded(h.get("x-forwarded-for"), hops) ?? h.get("x-real-ip") ?? "unknown";
}

export async function getUserAgent(): Promise<string> {
  return (await headers()).get("user-agent") ?? "";
}

/**
 * CSRF para Route Handlers mutáveis: exige `Origin` igual ao APP_URL (plano.md 10.4).
 * (Server Actions já têm a checagem de origem do próprio Next.)
 */
export function isSameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(getEnv().APP_URL).origin;
  } catch {
    return false;
  }
}

export function noStoreHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { "Cache-Control": "private, no-store, max-age=0", ...extra };
}

export function jsonError(code: string, status: number): Response {
  return Response.json({ error: code }, { status, headers: noStoreHeaders() });
}

/** Corpo que não chega dentro do prazo (envio lento demais ou proposital). */
export class BodyTimeoutError extends Error {
  constructor() {
    super("body_timeout");
    this.name = "BodyTimeoutError";
  }
}

/**
 * Lê o corpo da requisição contando os bytes de verdade e para ao passar de `maxBytes`
 * (não confia no Content-Length: com chunked ele nem existe). null = grande demais.
 * Prazo total de leitura (`timeoutMs`): estourou → BodyTimeoutError.
 */
export async function readBodyLimited(req: Request, maxBytes: number, timeoutMs = 300_000): Promise<Buffer | null> {
  const declared = Number(req.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) return null;
  if (!req.body) return Buffer.alloc(0);
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), Math.max(0, deadline - Date.now()));
    });
    let next: ReadableStreamReadResult<Uint8Array> | "timeout";
    try {
      next = await Promise.race([reader.read(), timeout]);
    } finally {
      clearTimeout(timer);
    }
    if (next === "timeout") {
      await reader.cancel().catch(() => undefined);
      throw new BodyTimeoutError();
    }
    const { done, value } = next;
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks, total);
}
