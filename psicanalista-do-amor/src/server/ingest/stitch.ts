import "server-only";

/**
 * Costura de prints sobrepostas (plano.md 4.5, passo 4): prints consecutivas costumam
 * repetir as últimas mensagens da anterior. Compara as últimas K mensagens de uma
 * print com as primeiras da seguinte (mesmo lado + texto parecido).
 */

export type OcrMessage = {
  imageIndex: number;
  side: "left" | "right" | "center";
  senderName: string | null;
  time: string | null;
  dayLabel: string | null;
  kind: "text" | "media" | "sticker" | "audio" | "deleted" | "system";
  text: string;
  legible: boolean;
};

export function normalizeForCompare(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{Extended_Pictographic}]+/gu, " ")
    .trim();
}

export function levenshtein(a: string, b: string, max = Infinity): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
      cur.push(v);
      rowMin = Math.min(rowMin, v);
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length]!;
}

const digits = (s: string) => s.replace(/\D+/g, "");

export function similarMessages(x: OcrMessage, y: OcrMessage): boolean {
  if (x.side !== y.side || x.kind !== y.kind) return false;
  // Horários diferentes lidos com clareza: mensagens diferentes.
  if (x.time && y.time && x.time.replace(/\s/g, "") !== y.time.replace(/\s/g, "")) return false;
  const a = normalizeForCompare(x.text);
  const b = normalizeForCompare(y.text);
  if (!a && !b) return x.time === y.time; // mídia/figurinha: compara pelo horário
  if (a === b) return true;
  // Números diferentes ("1" x "2", "18h" x "19h") mudam o sentido: não é a mesma mensagem.
  if (digits(a) !== digits(b)) return false;
  const longer = Math.max(a.length, b.length);
  const shorter = Math.min(a.length, b.length);
  // Balão cortado na borda da print: um texto é começo/fim do outro.
  if (shorter >= 8 && (a.startsWith(b) || b.startsWith(a) || a.endsWith(b) || b.endsWith(a))) return true;
  // Textos curtos só contam se forem iguais (erros de OCR pequenos viram outra palavra).
  if (shorter < 12) return false;
  const tolerance = Math.max(2, Math.floor(longer * 0.15));
  return levenshtein(a, b, tolerance) <= tolerance;
}

/** Junta as mensagens de várias prints removendo a sobreposição entre consecutivas. */
export function stitchImages(perImage: OcrMessage[][], window = 8): { messages: OcrMessage[]; removed: number } {
  const out: OcrMessage[] = [];
  let removed = 0;
  for (const [i, cur] of perImage.entries()) {
    if (i === 0 || out.length === 0) {
      out.push(...cur);
      continue;
    }
    const maxK = Math.min(window, out.length, cur.length);
    let overlap = 0;
    for (let k = maxK; k >= 1; k--) {
      const tail = out.slice(-k);
      if (tail.every((m, j) => similarMessages(m, cur[j]!))) {
        overlap = k;
        break;
      }
    }
    removed += overlap;
    out.push(...cur.slice(overlap));
  }
  return { messages: out, removed };
}
