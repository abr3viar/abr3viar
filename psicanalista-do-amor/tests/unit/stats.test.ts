import { describe, expect, it } from "vitest";
import {
  computePeriodStats,
  computeStats,
  formatPeriodStatsForPrompt,
  formatStatsForPrompt,
  type StatsInput,
} from "@/server/reports/stats";

const t = (iso: string) => new Date(iso);
let seq = 0;
const m = (sender: StatsInput["sender"], at: string | null, content: string, kind: StatsInput["kind"] = "text"): StatsInput => ({
  seq: ++seq,
  sender,
  sentAt: at ? t(at) : null,
  kind,
  content,
});

describe("stats determinísticas", () => {
  const msgs: StatsInput[] = [
    m("system", "2026-10-23T12:00:00Z", "aviso", "system"),
    m("a", "2026-10-23T12:00:00Z", "oi, tudo bem? 😊"),
    m("b", "2026-10-23T12:10:00Z", "tudo sim kkkk e você?"),
    m("a", "2026-10-23T12:12:00Z", "bem! saudade de você amor ❤️❤️"),
    m("a", "2026-10-23T14:30:00Z", "sumiu?"), // double text (2h18 sem resposta)
    m("b", "2026-10-23T23:00:00Z", "desculpa, dia corrido"), // 8h30 de silêncio -> iniciativa de B
    m("b", "2026-10-23T23:01:00Z", "", "audio"),
    m("a", "2026-10-23T23:05:00Z", "", "deleted"),
    m("other", "2026-10-23T23:06:00Z", "terceiro"),
  ];
  const stats = computeStats(msgs, { timeZone: "America/Sao_Paulo", hasTimestamps: true });

  it("conta mensagens, palavras, perguntas e emojis por pessoa", () => {
    expect(stats.analyzedMessages).toBe(7);
    expect(stats.a.messages).toBe(4);
    expect(stats.b.messages).toBe(3);
    expect(stats.a.questions).toBe(2);
    expect(stats.b.questions).toBe(1);
    expect(stats.a.emojis).toBe(3);
    expect(stats.a.topEmojis[0]).toEqual({ emoji: "❤️", count: 2 });
    expect(stats.b.laughs).toBe(1);
    expect(stats.a.affectionWords).toBe(2);
    expect(stats.b.audios).toBe(1);
    expect(stats.a.deleted).toBe(1);
  });

  it("iniciativas (após 6 h de silêncio), double texts e tempo de resposta", () => {
    expect(stats.a.initiations).toBe(1);
    expect(stats.b.initiations).toBe(1);
    expect(stats.a.doubleTexts).toBe(1);
    expect(stats.b.medianResponseMinutes).toBe(10);
    // A respondeu B em 2 min e em 4 min (23:01 -> 23:05) => mediana 3
    expect(stats.a.medianResponseMinutes).toBe(3);
  });

  it("período, horário mais ativo e última mensagem", () => {
    expect(stats.periodDays).toBe(1);
    expect(stats.lastMessageBy).toBe("a");
    expect(stats.activeHours).toHaveLength(24);
    expect(stats.busiestHour).toBe(9); // 12:00Z = 9h em São Paulo
  });

  it("sem timestamps omite métricas de tempo", () => {
    const s = computeStats(msgs, { timeZone: "America/Sao_Paulo", hasTimestamps: false });
    expect(s.a.medianResponseMinutes).toBeNull();
    expect(s.periodDays).toBeNull();
    expect(s.activeHours).toEqual([]);
    const text = formatStatsForPrompt(s, { a: "Ana", b: "Lucas" });
    expect(text).toContain("n/d");
  });

  it("formatação para o prompt contém só números e os nomes escolhidos", () => {
    const text = formatStatsForPrompt(stats, { a: "Ana", b: "Lucas" });
    expect(text).toContain("A (Ana) = 4");
    expect(text).not.toContain("saudade");
  });

  it("sem horários: iniciativa e mensagens seguidas saem como n/d (não '1' para quem abriu)", () => {
    const s = computeStats(msgs, { timeZone: "America/Sao_Paulo", hasTimestamps: false });
    const text = formatStatsForPrompt(s, { a: "Ana", b: "Lucas" });
    expect(text).toContain("- iniciou a conversa (após 6 h de silêncio): A (Ana) = n/d; B (Lucas) = n/d");
    expect(text).toContain("- mandou de novo sem resposta (2 h+): A (Ana) = n/d; B (Lucas) = n/d");
    expect(text).toContain("- tempo mediano de resposta (min): A (Ana) = n/d; B (Lucas) = n/d");
    expect(text).toContain("Sem horários nas mensagens");
    expect(text).toContain("Período: sem datas confiáveis");
  });

  it("tempo de resposta com a base (N respostas) e período com datas de início e fim", () => {
    const text = formatStatsForPrompt(stats, { a: "Ana", b: "Lucas" }, { timeZone: "America/Sao_Paulo" });
    expect(text).toContain("tempo mediano de resposta (min): A (Ana) = 3 (base: 2 respostas); B (Lucas) = 10 (base: 1 resposta)");
    expect(text).toContain("Período: de 23/10/2026 a 23/10/2026 (1 dia(s), 1 com mensagens)");
  });
});

describe("palavras de carinho com acento (lookarounds Unicode)", () => {
  const count = (content: string) =>
    computeStats([{ seq: 1, sender: "a", sentAt: null, kind: "text", content }], { timeZone: "UTC", hasTimestamps: false }).a.affectionWords;

  it("conta palavras que começam/terminam com acento e não conta pedaços de palavras", () => {
    expect(count("amo você")).toBe(1);
    expect(count("oi mozão")).toBe(1);
    expect(count("meu xodó!")).toBe(1);
    expect(count("Amo Você, mozão")).toBe(2);
    expect(count("amorteceu a queda")).toBe(0);
    expect(count("amorável")).toBe(0);
    expect(count("vidaloka")).toBe(0);
    expect(count("beijos 😘")).toBe(1);
  });

  it("risadas também respeitam limites Unicode", () => {
    const laughs = (content: string) =>
      computeStats([{ seq: 1, sender: "a", sentAt: null, kind: "text", content }], { timeZone: "UTC", hasTimestamps: false }).a.laughs;
    expect(laughs("kkkkk")).toBe(1);
    expect(laughs("hahaha né")).toBe(1);
    expect(laughs("rsrs")).toBe(1);
    expect(laughs("çkkkk")).toBe(0);
  });
});

describe("estatísticas por período (primeiro × último terço)", () => {
  const conv = (n: number, at: (i: number) => Date | null): StatsInput[] =>
    Array.from({ length: n }, (_, i) => ({
      seq: i + 1,
      sender: i % 2 ? "b" : "a",
      sentAt: at(i),
      kind: "text",
      // Começo com carinho; fim sem.
      content: i < n / 3 ? "saudade de você, amor?" : "ok",
    }));

  it("null para conversas curtas (< 40 mensagens)", () => {
    expect(computePeriodStats(conv(39, () => null), { timeZone: "UTC", hasTimestamps: false })).toBeNull();
  });

  it("divide em terços pelo número de mensagens, com as métricas comparáveis", () => {
    // 60 mensagens: 1 por hora no começo; 1 a cada 10 min no fim.
    const start = Date.UTC(2026, 0, 1, 12);
    const at = (i: number) => new Date(i < 40 ? start + i * 3_600_000 : start + 40 * 3_600_000 + (i - 40) * 600_000);
    const p = computePeriodStats(conv(60, at), { timeZone: "UTC", hasTimestamps: true })!;
    expect(p.firstSeqs).toEqual([1, 20]);
    expect(p.lastSeqs).toEqual([41, 60]);
    expect(p.first.analyzedMessages).toBe(20);
    expect(p.last.analyzedMessages).toBe(20);
    expect(p.first.a.affectionWords + p.first.b.affectionWords).toBeGreaterThan(0);
    expect(p.last.a.affectionWords + p.last.b.affectionWords).toBe(0);
    expect(p.first.a.medianResponseMinutes).toBe(60);
    expect(p.last.a.medianResponseMinutes).toBe(10);
    // A primeira mensagem do último terço não é "iniciativa": há a mensagem anterior (10 min antes).
    expect(p.last.a.initiations + p.last.b.initiations).toBe(0);
    const text = formatPeriodStatsForPrompt(p, { a: "Ana", b: "Lucas" }, { timeZone: "UTC" });
    expect(text).toContain("PRIMEIRO TERÇO (seq 1 a 20; de 01/01/2026 a 02/01/2026 (2 dia(s), 2 com mensagens))");
    expect(text).toContain("ÚLTIMO TERÇO (seq 41 a 60; de 03/01/2026 a 03/01/2026 (1 dia(s), 1 com mensagens))");
    expect(text).toContain("mensagens por dia com conversa: 10");
    expect(text).toContain("mensagens por dia com conversa: 20");
    expect(text).toContain("ÚLTIMO TERÇO (seq 41 a 60;");
    expect(text).toContain("palavras de carinho: A (Ana) = 0; B (Lucas) = 0");
    expect(text).toContain("mensagens por dia com conversa:");
    expect(text).not.toContain("#");
  });
});
