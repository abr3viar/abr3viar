import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { createLogger, safeErr, SafeError } from "@/server/log";

function capture() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      lines.push(String(chunk));
      cb();
    },
  });
  return { lines, stream };
}

const SECRET = "Ana disse: eu te amo, Lucas";

describe("logger com redact", () => {
  it("não registra conteúdo de conversa, nomes, e-mails nem payloads", () => {
    process.env.LOG_LEVEL = "info";
    const { lines, stream } = capture();
    const logger = createLogger(stream);
    logger.info(
      {
        conversationId: "0192-abc",
        content: SECRET,
        text: SECRET,
        email: "ana@example.com",
        message: { content: SECRET, text: SECRET },
        messages: [{ content: SECRET }],
        participantAName: "Ana",
        nested: { deep: { content: SECRET, email: "ana@example.com" } },
        req: { body: SECRET, headers: { authorization: "Bearer x", "stripe-signature": "t=1" } },
        failed_generation: SECRET,
        groq: { error: { failed_generation: SECRET } },
      },
      "teste",
    );
    const out = lines.join("");
    expect(out).toContain("0192-abc");
    expect(out).not.toContain("eu te amo");
    expect(out).not.toContain("ana@example.com");
    expect(out).not.toContain("Bearer x");
    expect(out).not.toContain("t=1");
    expect(out).not.toContain('"Ana"');
  });

  it("safeErr descarta a mensagem de erros de terceiros", () => {
    const err = Object.assign(new Error(`falhou ao gerar: ${SECRET}`), { status: 400, code: "json_validate_failed" });
    const safe = safeErr(err);
    expect(JSON.stringify(safe)).not.toContain("eu te amo");
    expect(safe.status).toBe(400);
    expect(safe.code).toBe("json_validate_failed");
  });

  it("safeErr mantém o código de SafeError", () => {
    expect(safeErr(new SafeError("ocr_failed"))).toEqual({ name: "SafeError", code: "ocr_failed" });
  });

  it("serializa err via safeErr", () => {
    const { lines, stream } = capture();
    createLogger(stream).error({ err: new Error(SECRET) }, "falha");
    expect(lines.join("")).not.toContain("eu te amo");
  });
});
