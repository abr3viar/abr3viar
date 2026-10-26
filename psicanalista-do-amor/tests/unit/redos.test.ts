import { describe, expect, it } from "vitest";
import { classifyContent, parseWhatsApp } from "@/server/ingest/whatsapp";
import { parseGeneric } from "@/server/ingest/generic";
import { neutralizeDelimiters } from "@/server/reports/context";
import { quoteMatches } from "@/server/reports/sections";

/**
 * S-01 (auditoria de segurança): entradas com sequências enormes de espaços não podem travar
 * o worker. Antes da correção, 200 mil espaços numa mensagem custavam ~2 min de CPU.
 */
const HUGE = " ".repeat(300_000);
const fast = (fn: () => unknown) => {
  const started = performance.now();
  fn();
  return performance.now() - started;
};

describe("ReDoS (S-01): tempo linear com entradas maliciosas", () => {
  it("parser do WhatsApp", () => {
    expect(fast(() => parseWhatsApp(`02/10/2026 06:00 - Ana: oi${HUGE}x\n02/10/2026 06:01 - Léo: oi${HUGE}`, "America/Sao_Paulo"))).toBeLessThan(1000);
  });
  it("marca de mensagem editada", () => {
    expect(fast(() => classifyContent(`oi${HUGE}x`))).toBeLessThan(1000);
    expect(classifyContent("te amo <mensagem editada>").content).toBe("te amo");
    expect(classifyContent("te amo   <This message was edited>  ").content).toBe("te amo");
    expect(classifyContent("<mensagem editada> no meio").content).toBe("<mensagem editada> no meio");
    expect(classifyContent("a < b > c").content).toBe("a < b > c");
  });
  it("parser genérico", () => {
    expect(fast(() => parseGeneric(`12:30${HUGE}!\nAna: oi\nLéo: oi`))).toBeLessThan(1000);
  });
  it("neutralização dos delimitadores do prompt", () => {
    expect(fast(() => neutralizeDelimiters(`<${HUGE}x`))).toBeLessThan(1000);
    expect(neutralizeDelimiters("a < / conversa> b")).toBe("a ‹ / conversa> b");
    expect(neutralizeDelimiters("</notas>")).toBe("‹/notas>");
  });
  it("conferência das citações", () => {
    expect(fast(() => quoteMatches(`[${HUGE}x`, "mensagem"))).toBeLessThan(1000);
    expect(quoteMatches("eu [...] você", "eu gosto de você")).toBe(true);
  });
});
