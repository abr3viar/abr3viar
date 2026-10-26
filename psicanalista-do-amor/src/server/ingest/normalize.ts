import "server-only";
import { parseGeneric } from "./generic";
import { decodeText, normalizeNewlines, assertPlainText } from "./decode";
import { parseWhatsApp } from "./whatsapp";
import { IngestError, type NormalizedMessage, type ParseResult } from "./types";

export type DetectedSender = {
  index: number;
  raw: string;
  count: number;
  samples: string[];
  /** Para prints: lado na tela. */
  side?: "left" | "right";
  /** Sugestão inicial: os dois mais frequentes viram a/b. */
  suggested: "a" | "b" | "other";
};

export type NormalizedConversation = {
  messages: (NormalizedMessage & { senderIndex: number | null; sender: "a" | "b" | "other" | "system" })[];
  senders: DetectedSender[];
  hasTimestamps: boolean;
  format: string;
  warnings: Record<string, number | boolean>;
};

export const MIN_RELIABLE_MESSAGES = 20;
const MAX_SAMPLE_CHARS = 90;
const MAX_MESSAGES = 60_000;

/** Lê texto (colado ou .txt) tentando WhatsApp e depois `Nome: mensagem`. */
export function parseConversationText(text: string, timeZone: string): ParseResult {
  const clean = normalizeNewlines(text);
  if (!clean.trim()) throw new IngestError("empty_input");
  const parsed = parseWhatsApp(clean, timeZone) ?? parseGeneric(clean);
  if (!parsed) throw new IngestError("unrecognized_format");
  return parsed;
}

export function parseTextBuffer(buf: Buffer, timeZone: string): ParseResult {
  const text = decodeText(buf);
  assertPlainText(text);
  return parseConversationText(text, timeZone);
}

function sampleOf(content: string): string {
  const oneLine = content.replace(/\s+/g, " ").trim();
  return oneLine.length > MAX_SAMPLE_CHARS ? `${oneLine.slice(0, MAX_SAMPLE_CHARS - 1)}…` : oneLine;
}

/**
 * Mapeia remetentes: os dois mais frequentes viram `a` e `b`, os demais `other`;
 * o usuário confirma na tela de confirmação (plano.md 4).
 */
export function normalizeConversation(
  parsed: ParseResult,
  options: { sides?: Map<string, "left" | "right"> } = {},
): NormalizedConversation {
  let messages = parsed.messages;
  const warnings: Record<string, number | boolean> = {};
  if (messages.length > MAX_MESSAGES) {
    messages = messages.slice(messages.length - MAX_MESSAGES);
    warnings.truncated_to_last = MAX_MESSAGES;
  }

  // Remetentes com nomes muito longos são, na prática, linhas de sistema.
  const counts = new Map<string, number>();
  for (const m of messages) {
    if (m.kind === "system" || !m.senderRaw) continue;
    counts.set(m.senderRaw, (counts.get(m.senderRaw) ?? 0) + 1);
  }
  for (const [raw, count] of counts) {
    if (raw.split(/\s+/).length >= 5 && count <= 2) counts.delete(raw);
  }

  const ordered = [...counts.entries()].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]));
  if (ordered.length === 0) throw new IngestError("no_messages");

  const senders: DetectedSender[] = ordered.map(([raw, count], index) => ({
    index,
    raw,
    count,
    samples: [],
    side: options.sides?.get(raw),
    suggested: index === 0 ? "a" : index === 1 ? "b" : "other",
  }));
  const byRaw = new Map(senders.map((s) => [s.raw, s]));

  const out: NormalizedConversation["messages"] = messages.map((m, i) => {
    const s = m.kind === "system" ? undefined : byRaw.get(m.senderRaw);
    const isSystem = !s;
    if (s && m.kind === "text" && s.samples.length < 3 && m.content.trim().length >= 8) {
      s.samples.push(sampleOf(m.content));
    }
    return {
      ...m,
      seq: i + 1,
      kind: isSystem ? "system" : m.kind,
      senderRaw: isSystem ? "" : m.senderRaw,
      senderIndex: s ? s.index : null,
      sender: s ? s.suggested : "system",
    };
  });

  const textCount = out.filter((m) => m.kind === "text" && (m.sender === "a" || m.sender === "b")).length;
  if (textCount < MIN_RELIABLE_MESSAGES) warnings.few_messages = textCount;
  if (senders.length > 2) warnings.group_chat = senders.length;
  if (senders.length < 2) warnings.single_sender = true;

  const withTime = out.filter((m) => m.sentAt).length;
  const hasTimestamps = parsed.hasTimestamps && withTime / Math.max(1, out.length) >= 0.6;

  const lowConfidence = out.filter((m) => m.source === "ocr" && (m.ocrConfidence ?? 1) < 0.6).length;
  if (lowConfidence > 0) warnings.ocr_low_confidence = lowConfidence;

  return { messages: out, senders, hasTimestamps, format: parsed.format, warnings };
}
