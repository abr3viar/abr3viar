import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseGeneric } from "@/server/ingest/generic";
import { normalizeConversation, parseConversationText } from "@/server/ingest/normalize";
import { IngestError } from "@/server/ingest/types";
import { decodeText } from "@/server/ingest/decode";

describe("parser genérico (Nome: mensagem)", () => {
  it("reconhece texto colado com multilinha e horário opcional", () => {
    const r = parseGeneric(readFileSync("tests/fixtures/pasted-generic.txt", "utf8"));
    expect(r).not.toBeNull();
    expect(r!.messages).toHaveLength(6);
    expect(r!.messages[2]!.content).toBe("bem também\nto com saudade");
    expect(r!.messages[4]).toMatchObject({ senderRaw: "Ana", content: "vamos sair sábado?" });
    expect(r!.hasTimestamps).toBe(false);
  });

  it("rejeita texto fora do formato", () => {
    expect(parseGeneric(readFileSync("tests/fixtures/not-a-chat.txt", "utf8"))).toBeNull();
    expect(parseGeneric("Ana: oi")).toBeNull();
  });

  it("parseConversationText tenta WhatsApp, depois genérico, depois erro amigável", () => {
    const wa = parseConversationText(readFileSync("tests/fixtures/whatsapp/android-ptbr-24h.txt", "utf8"), "America/Sao_Paulo");
    expect(wa.format).toContain("android");
    const gen = parseConversationText(readFileSync("tests/fixtures/pasted-generic.txt", "utf8"), "America/Sao_Paulo");
    expect(gen.format).toBe("generic");
    expect(() => parseConversationText("texto solto sem formato", "America/Sao_Paulo")).toThrow(IngestError);
    expect(() => parseConversationText("   ", "America/Sao_Paulo")).toThrow(IngestError);
  });
});

describe("normalização de remetentes", () => {
  it("os dois mais frequentes viram a e b; sistema fica separado; avisos", () => {
    const parsed = parseConversationText(decodeText(readFileSync("tests/fixtures/whatsapp/android-ptbr-24h.txt")), "America/Sao_Paulo");
    const n = normalizeConversation(parsed);
    expect(n.senders.map((s) => s.raw).sort()).toEqual(["Ana", "Lucas"]);
    expect(n.senders[0]!.suggested).toBe("a");
    expect(n.senders[1]!.suggested).toBe("b");
    expect(n.messages[0]!.sender).toBe("system");
    expect(n.messages[0]!.senderIndex).toBeNull();
    expect(n.warnings.few_messages).toBeGreaterThan(0);
    expect(n.hasTimestamps).toBe(true);
    // amostras curtas para a tela de confirmação
    expect(n.senders.every((s) => s.samples.every((x) => x.length <= 90))).toBe(true);
  });

  it("grupos: terceiros viram other e geram aviso", () => {
    const text = ["Ana: oi gente", "Lucas: oi Ana", "Bia: oi", "Ana: tudo bem?", "Lucas: tudo", "Ana: que bom"].join("\n");
    const n = normalizeConversation(parseConversationText(text, "America/Sao_Paulo"));
    expect(n.senders).toHaveLength(3);
    expect(n.messages.find((m) => m.senderRaw === "Bia")!.sender).toBe("other");
    expect(n.warnings.group_chat).toBe(3);
  });
});
