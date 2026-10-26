import { describe, expect, it } from "vitest";
import { ocrToNormalized, LEFT_LABEL, RIGHT_LABEL } from "@/server/ingest/images-ingest";
import { assignTimestamps, parseClock, resolveDayLabel } from "@/server/ingest/ocr-dates";
import { levenshtein, similarMessages, stitchImages, type OcrMessage } from "@/server/ingest/stitch";
import { zonedParts } from "@/server/ingest/time";

const msg = (side: OcrMessage["side"], text: string, extra: Partial<OcrMessage> = {}): OcrMessage => ({
  imageIndex: 0,
  side,
  senderName: null,
  time: null,
  dayLabel: null,
  kind: "text",
  text,
  legible: true,
  ...extra,
});

describe("costura de prints", () => {
  it("remove a sobreposição entre prints consecutivas", () => {
    const p1 = [msg("left", "oi"), msg("right", "tudo bem?"), msg("left", "tudo e vc"), msg("right", "to bem também!")];
    const p2 = [msg("left", "tudo e vc"), msg("right", "to bem tambem"), msg("left", "que bom"), msg("right", "bora sair?")];
    const p3 = [msg("left", "bora!"), msg("right", "18h?")];
    const { messages, removed } = stitchImages([p1, p2, p3]);
    expect(removed).toBe(2);
    expect(messages.map((m) => m.text)).toEqual(["oi", "tudo bem?", "tudo e vc", "to bem também!", "que bom", "bora sair?", "bora!", "18h?"]);
  });

  it("não remove mensagens iguais de lados diferentes nem quando não há sobreposição", () => {
    const { messages } = stitchImages([[msg("left", "ok")], [msg("right", "ok")]]);
    expect(messages).toHaveLength(2);
  });

  it("tolera erros pequenos de OCR e balões cortados na borda", () => {
    expect(similarMessages(msg("left", "você sumiu hoje"), msg("left", "voce sumiu hj"))).toBe(true);
    expect(similarMessages(msg("left", "tava com a cabeça cheia, desculpa"), msg("left", "com a cabeça cheia, desculpa"))).toBe(true);
    expect(similarMessages(msg("left", "vamos jantar"), msg("left", "vou dormir"))).toBe(false);
    expect(levenshtein("kitten", "sitting")).toBe(3);
  });
});

describe("datas das prints", () => {
  const ref = new Date("2026-10-25T15:00:00Z"); // domingo, 25/10/2026 12:00 em SP
  const tz = "America/Sao_Paulo";
  it("resolve Hoje, Ontem, '12 de outubro', dd/mm/aaaa e dia da semana", () => {
    expect(resolveDayLabel("Hoje", ref, tz)).toEqual({ y: 2026, m: 10, d: 25 });
    expect(resolveDayLabel("ONTEM", ref, tz)).toEqual({ y: 2026, m: 10, d: 24 });
    expect(resolveDayLabel("12 de outubro", ref, tz)).toEqual({ y: 2026, m: 10, d: 12 });
    expect(resolveDayLabel("30 de dezembro", ref, tz)).toEqual({ y: 2025, m: 12, d: 30 });
    expect(resolveDayLabel("05/09/2026", ref, tz)).toEqual({ y: 2026, m: 9, d: 5 });
    expect(resolveDayLabel("Sexta-feira", ref, tz)).toEqual({ y: 2026, m: 10, d: 23 });
    expect(resolveDayLabel("October 3, 2026", ref, tz)).toEqual({ y: 2026, m: 10, d: 3 });
    expect(resolveDayLabel("qualquer coisa", ref, tz)).toBeNull();
  });

  it("horários 24h e 12h", () => {
    expect(parseClock("23:41")).toEqual({ h: 23, m: 41 });
    expect(parseClock("11:41 PM")).toEqual({ h: 23, m: 41 });
    expect(parseClock("12:05 a.m.")).toEqual({ h: 0, m: 5 });
    expect(parseClock(null)).toBeNull();
  });

  it("sem separador de dia não inventa data; virada da meia-noite avança o dia", () => {
    const items = [
      { time: "23:00", dayLabel: null },
      { time: "23:50", dayLabel: "Ontem" },
      { time: "00:10", dayLabel: null },
    ];
    const out = assignTimestamps(items, ref, tz);
    expect(out[0]).toBeNull();
    expect(zonedParts(out[1]!, tz)).toMatchObject({ day: 24, hour: 23, minute: 50 });
    expect(zonedParts(out[2]!, tz)).toMatchObject({ day: 25, hour: 0, minute: 10 });
  });
});

describe("remetentes das prints", () => {
  const opts = { chatTitle: "Ana", reference: new Date("2026-10-25T15:00:00Z"), timeZone: "America/Sao_Paulo" };
  it("1:1: direita = quem tirou a print; esquerda = nome do cabeçalho; centro = sistema", () => {
    const r = ocrToNormalized(
      [msg("center", "Hoje", { kind: "system" }), msg("left", "oi"), msg("right", "oii"), msg("left", "[ilegível]", { legible: false })],
      opts,
    );
    expect(r.messages.map((m) => m.senderRaw)).toEqual(["", "Ana", RIGHT_LABEL, "Ana"]);
    expect(r.messages[0]!.kind).toBe("system");
    expect(r.sides.get("Ana")).toBe("left");
    expect(r.sides.get(RIGHT_LABEL)).toBe("right");
    expect(r.messages[3]!.ocrConfidence).toBeLessThan(0.6);
    expect(r.messages.every((m) => m.source === "ocr")).toBe(true);
  });

  it("grupo: nome acima do balão vale para os balões seguintes da mesma pessoa", () => {
    const r = ocrToNormalized(
      [msg("left", "oi", { senderName: "Bia" }), msg("left", "tudo?"), msg("left", "eai", { senderName: "Rafa" }), msg("right", "oi")],
      { ...opts, chatTitle: "Grupo da Faculdade" },
    );
    expect(r.messages.map((m) => m.senderRaw)).toEqual(["Bia", "Bia", "Rafa", RIGHT_LABEL]);
  });

  it("sem cabeçalho: Pessoa da esquerda", () => {
    const r = ocrToNormalized([msg("left", "oi"), msg("right", "oi")], { ...opts, chatTitle: null });
    expect(r.messages[0]!.senderRaw).toBe(LEFT_LABEL);
  });
});
