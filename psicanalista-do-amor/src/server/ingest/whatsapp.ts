import "server-only";
import { zonedTimeToUtc } from "./time";
import type { MessageKind, NormalizedMessage, ParseResult } from "./types";

/**
 * Parser de exportações do WhatsApp (.txt), plano.md 4.3.
 *
 * Formatos: Android (`23/10/2026 14:05 - Ana: oi`), Android 12 h
 * (`10/23/26, 2:05 PM - Ana: oi`), iOS (`[23/10/2026, 14:05:33] Ana: oi`) e iOS 12 h
 * (`[10/23/26, 2:05:33 PM] Ana: oi`), com variações de separador, ano com 2/4 dígitos,
 * caracteres invisíveis e `a.m./p.m.`. Linhas que não começam com data são continuação
 * da mensagem anterior.
 */

// Caracteres invisíveis que o WhatsApp insere (LRM, RLM, isolates, BOM...).
const INVISIBLE = /[‎‏‪-‮⁦-⁩﻿]/g;
// Espaços especiais (NBSP, narrow NBSP do iOS antes de AM/PM).
const ODD_SPACES = /[    ]/g;

const DATE = String.raw`(\d{1,4})[./-](\d{1,2})[./-](\d{1,4})`;
const TIME = String.raw`(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?`;
const AMPM = String.raw`(?:\s*([aApP])\.?\s?[mM]\.?)?`;

const IOS_RE = new RegExp(String.raw`^\[${DATE},?\s+${TIME}${AMPM}\]\s*(.*)$`);
const ANDROID_RE = new RegExp(String.raw`^${DATE},?\s+${TIME}${AMPM}\s*[-–—]\s+(.*)$`);

type RawEntry = {
  p1: number;
  p2: number;
  p3: number;
  hour: number;
  minute: number;
  second: number;
  ampm: "a" | "p" | null;
  rest: string;
  continuation: string[];
};

export function cleanLine(line: string): string {
  return line.replace(INVISIBLE, "").replace(ODD_SPACES, " ").replace(/\r$/, "");
}

function matchStart(line: string): { re: "ios" | "android"; m: RegExpExecArray } | null {
  const ios = IOS_RE.exec(line);
  if (ios) return { re: "ios", m: ios };
  const android = ANDROID_RE.exec(line);
  if (android) return { re: "android", m: android };
  return null;
}

function toEntry(m: RegExpExecArray): RawEntry {
  const ampmRaw = m[7];
  return {
    p1: Number(m[1]),
    p2: Number(m[2]),
    p3: Number(m[3]),
    hour: Number(m[4]),
    minute: Number(m[5]),
    second: m[6] ? Number(m[6]) : 0,
    ampm: ampmRaw ? (ampmRaw.toLowerCase() as "a" | "p") : null,
    rest: m[8] ?? "",
    continuation: [],
  };
}

type DateOrder = "dmy" | "mdy" | "ymd";

/** Decide a ordem dos campos da data olhando o conjunto todo (plano.md 4.3). */
export function detectDateOrder(entries: { p1: number; p2: number; p3: number }[]): DateOrder {
  if (entries.some((e) => e.p1 > 31)) return "ymd";
  if (entries.some((e) => e.p1 > 12)) return "dmy";
  if (entries.some((e) => e.p2 > 12)) return "mdy";
  return "dmy"; // ambíguo: público brasileiro
}

function normalizeYear(y: number): number {
  if (y < 100) return 2000 + y;
  return y;
}

function to24h(hour: number, ampm: "a" | "p" | null): number {
  if (!ampm) return hour;
  if (ampm === "a") return hour === 12 ? 0 : hour;
  return hour === 12 ? 12 : hour + 12;
}

const DELETED_PATTERNS = [
  /^esta mensagem foi apagada\.?$/i,
  /^voc[eê] apagou esta mensagem\.?$/i,
  /^mensagem apagada\.?$/i,
  /^this message was deleted\.?$/i,
  /^you deleted this message\.?$/i,
  /^se elimin[oó] este mensaje\.?$/i,
  /^eliminaste este mensaje\.?$/i,
];

const MEDIA_RULES: { re: RegExp; kind: MessageKind }[] = [
  { re: /^<?\s*(?:[áa]udio omitido|audio omitted|áudio ocultado)\s*>?$/i, kind: "audio" },
  { re: /^<?\s*(?:figurinha omitida|sticker omitted|figurinha ocultada)\s*>?$/i, kind: "sticker" },
  {
    re: /^<?\s*(?:m[íi]dia oculta|arquivo de m[íi]dia oculto|media omitted|imagem ocultada|imagem omitida|v[íi]deo omitido|v[íi]deo ocultado|gif omitido|gif omitted|documento omitido|document omitted|image omitted|video omitted|contact card omitted|cart[ãa]o de contato omitido|multimedia omitido)\s*>?$/i,
    kind: "media_omitted",
  },
];

const ATTACHED_RE = /^<\s*(?:anexado|attached|adjunto)\s*:\s*([^>]*)>$/i;

// Avisos do próprio WhatsApp que o iOS atribui ao nome do contato.
const SYSTEM_CONTENT = [
  /criptografia de ponta a ponta/i,
  /end-to-end encrypted/i,
  /cifrad[oa]s de extremo a extremo/i,
  /^mensagens tempor[áa]rias/i,
  /^disappearing messages/i,
];

export function isSystemContent(text: string): boolean {
  return SYSTEM_CONTENT.some((re) => re.test(text.trim()));
}

/** Marca de "editada" no FIM da mensagem. Testada só no trecho final (sem `\s*` solto: ReDoS, S-01). */
const EDITED_MARK = /^<(?:mensagem editada|this message was edited|se edit[oó] este mensaje)>$/i;

/** Tira " <mensagem editada>" do fim do texto (equivale a `/\s*<marca>\s*$/`, em tempo linear). */
function stripEditedSuffix(text: string): string {
  const end = text.trimEnd();
  if (!end.endsWith(">")) return text;
  const start = end.lastIndexOf("<");
  if (start < 0 || !EDITED_MARK.test(end.slice(start))) return text;
  return end.slice(0, start).trimEnd();
}

/** Classifica o texto de uma mensagem (mídia omitida, apagada etc.). */
export function classifyContent(text: string): { kind: MessageKind; content: string } {
  const trimmed = text.trim();
  if (DELETED_PATTERNS.some((re) => re.test(trimmed))) return { kind: "deleted", content: "" };
  for (const rule of MEDIA_RULES) {
    if (rule.re.test(trimmed)) return { kind: rule.kind, content: "" };
  }
  const attached = ATTACHED_RE.exec(trimmed);
  if (attached) {
    const name = (attached[1] ?? "").toUpperCase();
    if (name.includes("STICKER") || name.endsWith(".WEBP")) return { kind: "sticker", content: "" };
    if (name.includes("AUDIO") || /\.(OPUS|OGG|M4A|MP3|AAC)$/.test(name)) return { kind: "audio", content: "" };
    return { kind: "media_omitted", content: "" };
  }
  if (/^null$/i.test(trimmed)) return { kind: "media_omitted", content: "" };
  return { kind: "text", content: stripEditedSuffix(text) };
}

/** Separa "Nome: mensagem". Retorna null para linhas de sistema. */
export function splitSender(rest: string): { sender: string; text: string } | null {
  const m = /^([^:\n]{1,80}?):(?:\s(.*)|$)/s.exec(rest);
  if (!m) return null;
  const sender = (m[1] ?? "").trim();
  if (!sender) return null;
  return { sender, text: m[2] ?? "" };
}

/** Retorna true se o texto parece uma exportação do WhatsApp. */
export function looksLikeWhatsApp(text: string): boolean {
  const lines = text.split(/\n/, 400).map(cleanLine).filter((l) => l.trim());
  if (lines.length === 0) return false;
  const starts = lines.filter((l) => matchStart(l)).length;
  return starts >= Math.min(3, lines.length) && starts / lines.length >= 0.3;
}

export function parseWhatsApp(text: string, timeZone = "America/Sao_Paulo"): ParseResult | null {
  const lines = text.split("\n").map(cleanLine);
  const entries: (RawEntry & { kindHint: "ios" | "android" })[] = [];
  const counts = { ios: 0, android: 0 };

  for (const line of lines) {
    const start = matchStart(line);
    if (start) {
      counts[start.re] += 1;
      entries.push({ ...toEntry(start.m), kindHint: start.re });
    } else if (entries.length > 0) {
      entries[entries.length - 1]!.continuation.push(line);
    }
    // Linhas antes da primeira mensagem são ignoradas (cabeçalhos).
  }
  if (entries.length === 0) return null;
  if (entries.length < 3 && !looksLikeWhatsApp(text)) return null;

  const order = detectDateOrder(entries);
  const twelveHour = entries.some((e) => e.ampm !== null);
  const format = `${counts.ios >= counts.android ? "ios" : "android"}-${order}-${twelveHour ? "12h" : "24h"}`;

  const messages: NormalizedMessage[] = [];
  for (const e of entries) {
    let day: number;
    let month: number;
    let year: number;
    if (order === "ymd") [year, month, day] = [e.p1, e.p2, e.p3];
    else if (order === "mdy") [month, day, year] = [e.p1, e.p2, e.p3];
    else [day, month, year] = [e.p1, e.p2, e.p3];
    year = normalizeYear(year);
    const hour = to24h(e.hour, e.ampm);
    const valid =
      month >= 1 && month <= 12 && day >= 1 && day <= 31 && hour <= 23 && e.minute <= 59 && e.second <= 59;
    const sentAt = valid ? zonedTimeToUtc(year, month, day, hour, e.minute, e.second, timeZone) : null;

    const full = [e.rest, ...e.continuation].join("\n").trimEnd();
    const split = splitSender(e.rest);
    if (!split) {
      messages.push({
        seq: messages.length + 1,
        senderRaw: "",
        sentAt,
        kind: "system",
        content: full,
        source: "text",
      });
      continue;
    }
    const body = [split.text, ...e.continuation].join("\n").trimEnd();
    if (isSystemContent(body)) {
      messages.push({ seq: messages.length + 1, senderRaw: "", sentAt, kind: "system", content: body, source: "text" });
      continue;
    }
    const { kind, content } = classifyContent(body);
    messages.push({
      seq: messages.length + 1,
      senderRaw: split.sender,
      sentAt,
      kind,
      content,
      source: "text",
    });
  }

  const nonSystem = messages.filter((m) => m.kind !== "system");
  if (nonSystem.length === 0) return null;
  return { messages, format, hasTimestamps: messages.some((m) => m.sentAt !== null) };
}
