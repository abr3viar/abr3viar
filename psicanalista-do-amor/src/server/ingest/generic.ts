import "server-only";
import { classifyContent, cleanLine } from "./whatsapp";
import type { NormalizedMessage, ParseResult } from "./types";

/**
 * Parser genérico para texto colado no formato `Nome: mensagem` (plano.md 4.2).
 * Aceita um horário opcional no início (`[14:05] Ana: oi`, `14:05 - Ana: oi`).
 * Linhas que não casam são continuação da mensagem anterior.
 * Sem IA para "adivinhar" formatos (D21).
 */

const LINE_RE =
  /^(?:\[?(\d{1,2})[:h.](\d{2})(?:[:.]\d{2})?\]?\s*(?:[-–—]\s*)?)?([\p{L}\p{N}][\p{L}\p{N} ._'’-]{0,39}?)\s*:\s?(.*)$/u;

const MAX_NAME_WORDS = 4;

export function parseGeneric(text: string): ParseResult | null {
  const lines = text.split("\n").map(cleanLine);
  type Entry = { sender: string; first: string; rest: string[] };
  const entries: Entry[] = [];
  let matched = 0;
  let nonEmpty = 0;

  for (const line of lines) {
    if (line.trim()) nonEmpty += 1;
    const m = LINE_RE.exec(line.trim());
    const sender = m?.[3]?.trim();
    if (m && sender && sender.split(/\s+/).length <= MAX_NAME_WORDS && !/^https?$/i.test(sender)) {
      matched += 1;
      entries.push({ sender, first: m[4] ?? "", rest: [] });
    } else if (entries.length > 0) {
      entries[entries.length - 1]!.rest.push(line);
    }
  }
  if (entries.length < 2) return null;

  // Precisa de pelo menos 2 remetentes que se repetem e a maioria das linhas no formato.
  const counts = new Map<string, number>();
  for (const e of entries) counts.set(e.sender, (counts.get(e.sender) ?? 0) + 1);
  const recurring = [...counts.values()].filter((c) => c >= 2).length;
  const distinct = counts.size;
  if (distinct < 2) return null;
  if (entries.length >= 6 && recurring < 2) return null;
  if (matched / Math.max(1, nonEmpty) < 0.5) return null;
  // Muitos "remetentes" únicos indicam que o texto não está nesse formato.
  if (distinct > Math.max(6, entries.length / 2)) return null;

  const messages: NormalizedMessage[] = entries.map((e, i) => {
    const body = [e.first, ...e.rest].join("\n").trimEnd();
    const { kind, content } = classifyContent(body);
    return { seq: i + 1, senderRaw: e.sender, sentAt: null, kind, content, source: "text" };
  });
  return { messages, format: "generic", hasTimestamps: false };
}
