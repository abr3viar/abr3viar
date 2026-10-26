import "server-only";
import pino, { type Logger, type DestinationStream } from "pino";

/**
 * Logger estruturado (plano.md 10.5). Nunca registrar conteúdo de conversas, nomes,
 * texto de relatórios, respostas da Groq, payloads do Stripe ou e-mails.
 * Registrar só IDs, status, contagens, durações, tokens e códigos de erro.
 */

const SENSITIVE_KEYS = [
  "content",
  "text",
  "messages",
  "message_text",
  "email",
  "body",
  "authorization",
  "cookie",
  "stripe-signature",
  "name",
  "names",
  "participantAName",
  "participantBName",
  "senderRaw",
  "sender_raw",
  "quote",
  "evidence",
  "hook",
  "hookText",
  "title",
  "failed_generation",
  "prompt",
  "token",
  "password",
  "secret",
];

export const REDACT_PATHS = SENSITIVE_KEYS.flatMap((k) => {
  const key = /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(k) ? k : `["${k}"]`;
  const dot = key.startsWith("[") ? "" : ".";
  return [key, `*${dot}${key}`, `*.*${dot}${key}`, `*.*.*${dot}${key}`];
});

/**
 * Converte um erro em algo seguro de logar: nome, código e status HTTP.
 * A mensagem só é mantida para erros nossos marcados como seguros (`SafeError`),
 * porque mensagens de bibliotecas podem conter trechos de conteúdo (ex.: Groq).
 */
export function safeErr(err: unknown): Record<string, string | number | undefined> {
  if (err instanceof SafeError) return { name: err.name, code: err.code };
  // Erros de configuração listam só nomes de variáveis (nunca valores).
  if (err instanceof Error && err.name === "EnvError") return { name: err.name, message: err.message };
  if (err && typeof err === "object") {
    const e = err as { name?: unknown; code?: unknown; status?: unknown; type?: unknown };
    return {
      name: typeof e.name === "string" ? e.name : "Error",
      code: typeof e.code === "string" || typeof e.code === "number" ? e.code : undefined,
      status: typeof e.status === "number" ? e.status : undefined,
      type: typeof e.type === "string" ? e.type : undefined,
    };
  }
  return { name: "UnknownError" };
}

/** Erro com código genérico, seguro para log e para gravar em `error_code`. */
export class SafeError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.name = "SafeError";
    this.code = code;
  }
}

export function createLogger(destination?: DestinationStream): Logger {
  return pino(
    {
      level: process.env.LOG_LEVEL ?? "info",
      base: { service: process.env.PROCESS_ROLE ?? "app" },
      redact: { paths: REDACT_PATHS, censor: "[redacted]" },
      serializers: { err: safeErr, error: safeErr },
      timestamp: pino.stdTimeFunctions.isoTime,
    },
    destination,
  );
}

const holder = globalThis as unknown as { __pdaLogger?: Logger };
export const log: Logger = (holder.__pdaLogger ??= createLogger());
