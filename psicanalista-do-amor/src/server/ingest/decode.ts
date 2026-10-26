import "server-only";
import { IngestError } from "./types";

/**
 * Decodifica um .txt: UTF-8 (com ou sem BOM), UTF-16 LE/BE (com BOM ou detectado
 * por bytes nulos — algumas exportações do iPhone) e, em último caso, Windows-1252.
 */
export function decodeText(buf: Buffer): string {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return new TextDecoder("utf-8").decode(buf.subarray(3));
  }
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return new TextDecoder("utf-16le").decode(buf.subarray(2));
  }
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    return new TextDecoder("utf-16be").decode(buf.subarray(2));
  }
  // UTF-16 sem BOM: muitos bytes nulos em posições alternadas.
  const sample = buf.subarray(0, Math.min(buf.length, 4096));
  let zeroEven = 0;
  let zeroOdd = 0;
  for (let i = 0; i < sample.length; i++) {
    if (sample[i] === 0) {
      if (i % 2 === 0) zeroEven++;
      else zeroOdd++;
    }
  }
  const half = sample.length / 2;
  if (half > 8 && zeroOdd / half > 0.3) return new TextDecoder("utf-16le").decode(buf);
  if (half > 8 && zeroEven / half > 0.3) return new TextDecoder("utf-16be").decode(buf);

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder("windows-1252").decode(buf);
  }
}

/** Texto plausível: sem bytes nulos e com poucos caracteres de controle. */
export function assertPlainText(text: string): void {
  if (text.includes("\u0000")) throw new IngestError("invalid_text_file");
  const control = text.match(/[\u0001-\u0008\u000b\u000c\u000e-\u001f]/g)?.length ?? 0;
  if (control > Math.max(10, text.length * 0.01)) throw new IngestError("invalid_text_file");
}

export function normalizeNewlines(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}
