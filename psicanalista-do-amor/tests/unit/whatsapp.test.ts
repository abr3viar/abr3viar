import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseWhatsApp, detectDateOrder, classifyContent, looksLikeWhatsApp } from "@/server/ingest/whatsapp";
import { decodeText } from "@/server/ingest/decode";
import { zonedParts } from "@/server/ingest/time";

const fx = (name: string) => readFileSync(`tests/fixtures/whatsapp/${name}`);
const parse = (name: string) => {
  const r = parseWhatsApp(decodeText(fx(name)));
  if (!r) throw new Error("não reconheceu");
  return r;
};
const sp = (d: Date | null) => (d ? zonedParts(d, "America/Sao_Paulo") : null);

describe("parser do WhatsApp", () => {
  it("Android pt-BR 24h: mensagens, sistema, multilinha, mídia, apagadas, áudio, editada", () => {
    const r = parse("android-ptbr-24h.txt");
    expect(r.format).toBe("android-dmy-24h");
    expect(r.hasTimestamps).toBe(true);
    const [first, oi, , , multi, media, deleted, audio] = r.messages;
    expect(first!.kind).toBe("system");
    expect(oi).toMatchObject({ senderRaw: "Ana", kind: "text", content: "oi" });
    expect(multi!.content).toBe("to bem! saindo do trabalho agora\nolha isso que aconteceu hoje:\no chefe trouxe bolo");
    expect(media!.kind).toBe("media_omitted");
    expect(deleted!.kind).toBe("deleted");
    expect(audio!.kind).toBe("audio");
    const edited = r.messages.find((m) => m.content.startsWith("bom diaa"));
    expect(edited!.content).toBe("bom diaa");
    expect(r.messages.at(-1)!.kind).toBe("system");
    expect(sp(oi!.sentAt)).toMatchObject({ year: 2026, month: 10, day: 23, hour: 14, minute: 5 });
    // 14:05 em São Paulo (UTC-3) = 17:05 UTC
    expect(oi!.sentAt!.toISOString()).toBe("2026-10-23T17:05:00.000Z");
  });

  it("Android 12h (MM/DD, AM/PM e a.m./p.m.)", () => {
    const r = parse("android-12h.txt");
    expect(r.format).toBe("android-mdy-12h");
    expect(sp(r.messages[2]!.sentAt)).toMatchObject({ month: 10, day: 23, hour: 23, minute: 59 });
    expect(sp(r.messages[3]!.sentAt)).toMatchObject({ day: 24, hour: 0, minute: 1 });
    expect(sp(r.messages[4]!.sentAt)).toMatchObject({ hour: 0, minute: 30 });
    expect(r.messages[4]!.kind).toBe("media_omitted");
    expect(sp(r.messages[5]!.sentAt)).toMatchObject({ hour: 13, minute: 15 });
    expect(r.messages[5]!.kind).toBe("deleted");
  });

  it("iOS pt-BR com caracteres invisíveis, anexos e figurinhas", () => {
    const r = parse("ios-ptbr.txt");
    expect(r.format).toBe("ios-dmy-24h");
    expect(r.messages[0]!.kind).toBe("system");
    expect(r.messages[1]).toMatchObject({ senderRaw: "Ana", content: "oi, sumido" });
    expect(r.messages[3]!.kind).toBe("media_omitted");
    expect(r.messages[4]!.kind).toBe("media_omitted");
    expect(r.messages[5]!.kind).toBe("sticker");
    expect(r.messages[6]!.content).toBe("primeira linha\nsegunda linha\n\nquarta linha depois de uma vazia");
    expect(r.messages[7]!.kind).toBe("deleted");
    expect(sp(r.messages[1]!.sentAt)).toMatchObject({ hour: 14, minute: 5, second: 33 });
  });

  it("iOS 12h com espaço estreito antes de PM", () => {
    const r = parse("ios-12h.txt");
    expect(r.format).toBe("ios-mdy-12h");
    expect(sp(r.messages[0]!.sentAt)).toMatchObject({ hour: 14, minute: 5 });
    expect(sp(r.messages[2]!.sentAt)).toMatchObject({ hour: 0, minute: 0 });
    expect(r.messages[3]!.kind).toBe("audio");
  });

  it("UTF-16 com BOM", () => {
    const r = parse("utf16-ios.txt");
    expect(r.messages).toHaveLength(3);
    expect(r.messages[2]!.content).toBe("ação");
  });

  it("datas ambíguas assumem DD/MM; segundo campo > 12 indica MM/DD", () => {
    const amb = parse("ambiguous-dates.txt");
    expect(sp(amb.messages[0]!.sentAt)).toMatchObject({ day: 5, month: 6 });
    const mdy = parse("mdy-dates.txt");
    expect(sp(mdy.messages[0]!.sentAt)).toMatchObject({ month: 5, day: 6 });
    expect(detectDateOrder([{ p1: 13, p2: 1, p3: 26 }])).toBe("dmy");
    expect(detectDateOrder([{ p1: 1, p2: 13, p3: 26 }])).toBe("mdy");
    expect(detectDateOrder([{ p1: 1, p2: 2, p3: 3 }])).toBe("dmy");
    expect(detectDateOrder([{ p1: 2026, p2: 10, p3: 23 }])).toBe("ymd");
  });

  it("variantes: en-dash, ponto como separador e dois-pontos no conteúdo", () => {
    const r = parse("variants.txt");
    expect(r.messages).toHaveLength(3);
    expect(r.messages[1]).toMatchObject({ senderRaw: "Lucas", content: "oi: tudo bem?" });
    expect(r.messages[2]!.content).toBe("link https://exemplo.com.br/a:b");
  });

  it("não reconhece texto que não é exportação", () => {
    const txt = readFileSync("tests/fixtures/not-a-chat.txt", "utf8");
    expect(parseWhatsApp(txt)).toBeNull();
    expect(looksLikeWhatsApp(txt)).toBe(false);
  });

  it("classifica conteúdos especiais", () => {
    expect(classifyContent("<Media omitted>").kind).toBe("media_omitted");
    expect(classifyContent("figurinha omitida").kind).toBe("sticker");
    expect(classifyContent("Você apagou esta mensagem").kind).toBe("deleted");
    expect(classifyContent("<anexado: 0001-AUDIO-2026.opus>").kind).toBe("audio");
    expect(classifyContent("oi").kind).toBe("text");
  });
});
