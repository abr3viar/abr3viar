import "server-only";
import { zonedParts } from "@/server/ingest/time";

/**
 * Estatísticas determinísticas (plano.md 4.6) — só números, sem conteúdo.
 * Entram no prompt como FATOS para a IA não inventar estatísticas.
 */

export type StatsInput = {
  seq: number;
  sender: "a" | "b" | "other" | "system";
  sentAt: Date | null;
  kind: "text" | "media_omitted" | "deleted" | "sticker" | "audio" | "system";
  content: string;
};

export type SideStats = {
  messages: number;
  textMessages: number;
  words: number;
  avgWordsPerMessage: number;
  questions: number;
  emojis: number;
  topEmojis: { emoji: string; count: number }[];
  initiations: number;
  medianResponseMinutes: number | null;
  responsesMeasured: number;
  doubleTexts: number;
  deleted: number;
  media: number;
  audios: number;
  stickers: number;
  longestMessageWords: number;
  laughs: number;
  affectionWords: number;
};

export type ConversationStats = {
  version: 1;
  totalMessages: number;
  analyzedMessages: number;
  hasTimestamps: boolean;
  periodDays: number | null;
  activeDays: number | null;
  firstMessageAt: string | null;
  lastMessageAt: string | null;
  lastMessageBy: "a" | "b" | null;
  a: SideStats;
  b: SideStats;
  /** 24 posições: mensagens por hora do dia (fuso da conversa). */
  activeHours: number[];
  busiestHour: number | null;
  messageShareA: number; // 0–100
};

export const SILENCE_HOURS_FOR_INITIATION = 6;
const DOUBLE_TEXT_MINUTES = 120;
const MAX_RESPONSE_HOURS = 24;

const EMOJI_RE = /\p{Extended_Pictographic}️?(?:‍\p{Extended_Pictographic}️?)*/gu;
// Limites de palavra com lookarounds Unicode: o \b do JS só conhece [A-Za-z0-9_] e falha em
// palavras que começam/terminam com acento ("você", "mozão", "xodó").
const LAUGH_RE = /(?<![\p{L}\p{N}_])(?:k{3,}|(?:ha){2,}h?|(?:he){2,}|(?:rs){2,}|lol)(?![\p{L}\p{N}_])/giu;
const AFFECTION_RE =
  /(?<![\p{L}\p{N}_])(?:amor|te amo|amo voc[eê]|saudade|saudades|lind[ao]|gat[ao]|fofo|fofa|beijo|beijos|bj|bjs|carinho|querid[ao]|meu bem|vida|mozão|mozao|morzinho|xodó|xodo)(?![\p{L}\p{N}_])/giu;

function emptySide(): SideStats {
  return {
    messages: 0,
    textMessages: 0,
    words: 0,
    avgWordsPerMessage: 0,
    questions: 0,
    emojis: 0,
    topEmojis: [],
    initiations: 0,
    medianResponseMinutes: null,
    responsesMeasured: 0,
    doubleTexts: 0,
    deleted: 0,
    media: 0,
    audios: 0,
    stickers: 0,
    longestMessageWords: 0,
    laughs: 0,
    affectionWords: 0,
  };
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((x, y) => x - y);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

function dayNumber(d: Date, timeZone: string): number {
  const p = zonedParts(d, timeZone);
  return Math.floor(Date.UTC(p.year, p.month - 1, p.day) / 86_400_000);
}

function calendarDays(first: Date, last: Date, timeZone: string): number {
  return Math.max(1, dayNumber(last, timeZone) - dayNumber(first, timeZone) + 1);
}

export function computeStats(
  input: StatsInput[],
  options: {
    timeZone: string;
    hasTimestamps: boolean;
    /**
     * Mensagem imediatamente anterior ao trecho (estatísticas por período): a primeira
     * mensagem do trecho só conta como iniciativa/resposta em relação a ela.
     */
    previous?: StatsInput | null;
  },
): ConversationStats {
  const msgs = input.filter((m) => m.sender === "a" || m.sender === "b") as (StatsInput & {
    sender: "a" | "b";
  })[];
  const sides = { a: emptySide(), b: emptySide() };
  const emojiCounts = { a: new Map<string, number>(), b: new Map<string, number>() };
  const responseTimes: Record<"a" | "b", number[]> = { a: [], b: [] };
  const activeHours = new Array<number>(24).fill(0);
  const days = new Set<string>();
  const useTime = options.hasTimestamps;

  const before = options.previous;
  let prev: (typeof msgs)[number] | null =
    before && (before.sender === "a" || before.sender === "b") ? (before as (typeof msgs)[number]) : null;
  for (const m of msgs) {
    const s = sides[m.sender];
    s.messages += 1;
    if (m.kind === "deleted") s.deleted += 1;
    if (m.kind === "media_omitted") s.media += 1;
    if (m.kind === "audio") s.audios += 1;
    if (m.kind === "sticker") s.stickers += 1;
    if (m.kind === "text") {
      s.textMessages += 1;
      const words = m.content.split(/\s+/).filter(Boolean).length;
      s.words += words;
      s.longestMessageWords = Math.max(s.longestMessageWords, words);
      s.questions += (m.content.match(/\?/g) ?? []).length > 0 ? 1 : 0;
      s.laughs += (m.content.match(LAUGH_RE) ?? []).length;
      s.affectionWords += (m.content.match(AFFECTION_RE) ?? []).length;
      for (const e of m.content.match(EMOJI_RE) ?? []) {
        s.emojis += 1;
        emojiCounts[m.sender].set(e, (emojiCounts[m.sender].get(e) ?? 0) + 1);
      }
    }

    if (useTime && m.sentAt) {
      const p = zonedParts(m.sentAt, options.timeZone);
      activeHours[p.hour] = (activeHours[p.hour] ?? 0) + 1;
      days.add(`${p.year}-${p.month}-${p.day}`);
    }

    // Iniciativa: primeira mensagem da conversa ou após 6 h de silêncio.
    if (!prev) s.initiations += 1;
    else if (useTime && m.sentAt && prev.sentAt) {
      const gapH = (m.sentAt.getTime() - prev.sentAt.getTime()) / 3_600_000;
      if (gapH >= SILENCE_HOURS_FOR_INITIATION) s.initiations += 1;
      const gapMin = gapH * 60;
      if (prev.sender !== m.sender) {
        // Depois de 6 h de silêncio é uma nova iniciativa, não uma resposta.
        if (gapH >= 0 && gapH < Math.min(MAX_RESPONSE_HOURS, SILENCE_HOURS_FOR_INITIATION)) {
          responseTimes[m.sender].push(gapMin);
        }
      } else if (gapMin >= DOUBLE_TEXT_MINUTES && gapH < SILENCE_HOURS_FOR_INITIATION) {
        s.doubleTexts += 1;
      }
    }
    prev = m;
  }

  for (const side of ["a", "b"] as const) {
    const s = sides[side];
    s.avgWordsPerMessage = s.textMessages ? round1(s.words / s.textMessages) : 0;
    const med = median(responseTimes[side]);
    s.medianResponseMinutes = med === null ? null : round1(med);
    s.responsesMeasured = responseTimes[side].length;
    s.topEmojis = [...emojiCounts[side].entries()]
      .sort((x, y) => y[1] - x[1])
      .slice(0, 5)
      .map(([emoji, count]) => ({ emoji, count }));
  }

  const timed = msgs.filter((m) => m.sentAt) as (StatsInput & { sentAt: Date })[];
  const first = useTime && timed.length ? timed[0]!.sentAt : null;
  const last = useTime && timed.length ? timed[timed.length - 1]!.sentAt : null;
  const total = sides.a.messages + sides.b.messages;
  const busiest = useTime && total ? activeHours.indexOf(Math.max(...activeHours)) : null;

  return {
    version: 1,
    totalMessages: input.length,
    analyzedMessages: total,
    hasTimestamps: useTime,
    // Dias de calendário (no fuso da conversa), contando o primeiro e o último: assim
    // "N dia(s), M com mensagens" nunca tem M > N.
    periodDays: first && last ? calendarDays(first, last, options.timeZone) : null,
    activeDays: useTime ? days.size : null,
    firstMessageAt: first ? first.toISOString() : null,
    lastMessageAt: last ? last.toISOString() : null,
    lastMessageBy: msgs.length ? msgs[msgs.length - 1]!.sender : null,
    a: sides.a,
    b: sides.b,
    activeHours: useTime ? activeHours : [],
    busiestHour: busiest,
    messageShareA: total ? Math.round((sides.a.messages / total) * 100) : 50,
  };
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** dd/mm/aaaa no fuso da conversa. */
export function formatDate(iso: string, timeZone: string): string {
  const p = zonedParts(new Date(iso), timeZone);
  return `${pad2(p.day)}/${pad2(p.month)}/${p.year}`;
}

/** Base abaixo disso é "amostra pequena" (regra no prompt: não tirar conclusões fortes). */
export const SMALL_SAMPLE = 10;

type Names = { a: string; b: string };
type Val = string | number | null;

function sideLine(label: string, a: Val, b: Val, names: Names): string {
  return `- ${label}: A (${names.a}) = ${a ?? "n/d"}; B (${names.b}) = ${b ?? "n/d"}`;
}

function responseValue(stats: ConversationStats, side: "a" | "b"): string {
  if (!stats.hasTimestamps) return "n/d";
  const s = stats[side];
  const base = `(base: ${s.responsesMeasured} resposta${s.responsesMeasured === 1 ? "" : "s"})`;
  return `${s.medianResponseMinutes ?? "n/d"} ${base}`;
}

/** Linhas por pessoa (as mesmas no total e nos períodos, para comparar igual com igual). */
function sideLines(stats: ConversationStats, names: Names, full: boolean): string[] {
  const sa = stats.a;
  const sb = stats.b;
  const timed = stats.hasTimestamps;
  const lines = [
    sideLine("mensagens", sa.messages, sb.messages, names),
    ...(full ? [sideLine("palavras", sa.words, sb.words, names)] : []),
    sideLine("média de palavras por mensagem", sa.avgWordsPerMessage, sb.avgWordsPerMessage, names),
    sideLine("mensagens com pergunta", sa.questions, sb.questions, names),
    // Sem horários não há como saber o que é "puxar assunto" (nem silêncio de 6 h).
    sideLine("iniciou a conversa (após 6 h de silêncio)", timed ? sa.initiations : null, timed ? sb.initiations : null, names),
    sideLine("tempo mediano de resposta (min)", responseValue(stats, "a"), responseValue(stats, "b"), names),
    sideLine("mandou de novo sem resposta (2 h+)", timed ? sa.doubleTexts : null, timed ? sb.doubleTexts : null, names),
    sideLine("emojis", sa.emojis, sb.emojis, names),
    ...(full ? [sideLine("risadas (kkk, haha, rs)", sa.laughs, sb.laughs, names)] : []),
    sideLine("palavras de carinho", sa.affectionWords, sb.affectionWords, names),
  ];
  if (full) {
    lines.push(
      sideLine("áudios", sa.audios, sb.audios, names),
      sideLine("mídias", sa.media, sb.media, names),
      sideLine("mensagens apagadas", sa.deleted, sb.deleted, names),
    );
  }
  return lines;
}

function periodLine(stats: ConversationStats, timeZone: string): string {
  if (!stats.periodDays || !stats.firstMessageAt || !stats.lastMessageAt) return "Período: sem datas confiáveis";
  return `Período: de ${formatDate(stats.firstMessageAt, timeZone)} a ${formatDate(stats.lastMessageAt, timeZone)} (${stats.periodDays} dia(s), ${stats.activeDays} com mensagens)`;
}

/** Versão compacta em texto para o prompt (números como fatos). */
export function formatStatsForPrompt(
  stats: ConversationStats,
  names: Names,
  options: { timeZone?: string } = {},
): string {
  const tz = options.timeZone ?? "America/Sao_Paulo";
  const out = [
    `Mensagens analisadas: ${stats.analyzedMessages} (A ${stats.messageShareA}% / B ${100 - stats.messageShareA}%)`,
    periodLine(stats, tz),
    ...(stats.hasTimestamps
      ? []
      : ["Sem horários nas mensagens: iniciativa, tempo de resposta e mensagens seguidas sem resposta não podem ser medidos (n/d)."]),
    ...sideLines(stats, names, true),
    `Última mensagem enviada por: ${stats.lastMessageBy === "a" ? names.a : stats.lastMessageBy === "b" ? names.b : "n/d"}`,
  ];
  if (stats.busiestHour !== null) out.push(`Horário mais ativo: ${stats.busiestHour}h`);
  return out.join("\n");
}

/** Mínimo de mensagens (A+B) para comparar o primeiro e o último terço. */
export const PERIOD_STATS_MIN_MESSAGES = 40;

export type PeriodStats = {
  first: ConversationStats;
  last: ConversationStats;
  firstSeqs: [number, number];
  lastSeqs: [number, number];
};

/**
 * Estatísticas do primeiro e do último terço da conversa (por número de mensagens),
 * com o mesmo `computeStats`: base dos relatórios "esfriando" e "linha do tempo".
 * `null` se a conversa for curta demais para a comparação valer alguma coisa.
 */
export function computePeriodStats(
  input: StatsInput[],
  options: { timeZone: string; hasTimestamps: boolean },
): PeriodStats | null {
  const msgs = input.filter((m) => m.sender === "a" || m.sender === "b");
  if (msgs.length < PERIOD_STATS_MIN_MESSAGES) return null;
  const third = Math.floor(msgs.length / 3);
  const firstPart = msgs.slice(0, third);
  const lastStart = msgs.length - third;
  const lastPart = msgs.slice(lastStart);
  return {
    first: computeStats(firstPart, options),
    last: computeStats(lastPart, { ...options, previous: msgs[lastStart - 1] ?? null }),
    firstSeqs: [firstPart[0]!.seq, firstPart[firstPart.length - 1]!.seq],
    lastSeqs: [lastPart[0]!.seq, lastPart[lastPart.length - 1]!.seq],
  };
}

function perActiveDay(stats: ConversationStats): string | null {
  if (!stats.hasTimestamps || !stats.activeDays) return null;
  return String(Math.round((stats.analyzedMessages / stats.activeDays) * 10) / 10);
}

/** Bloco "ESTATÍSTICAS POR PERÍODO" (só números; mesmas métricas nos dois períodos). */
export function formatPeriodStatsForPrompt(period: PeriodStats, names: Names, options: { timeZone?: string } = {}): string {
  const tz = options.timeZone ?? "America/Sao_Paulo";
  const block = (label: string, st: ConversationStats, seqs: [number, number]) =>
    [
      `${label} (seq ${seqs[0]} a ${seqs[1]}; ${periodLine(st, tz).replace(/^Período: /, "")})`,
      `- mensagens por dia com conversa: ${perActiveDay(st) ?? "n/d"}`,
      ...sideLines(st, names, false),
    ].join("\n");
  return [
    "Cada período tem o mesmo número de mensagens; compare ritmo por dia, proporções e médias, não o total.",
    block("PRIMEIRO TERÇO", period.first, period.firstSeqs),
    block("ÚLTIMO TERÇO", period.last, period.lastSeqs),
  ].join("\n\n");
}
