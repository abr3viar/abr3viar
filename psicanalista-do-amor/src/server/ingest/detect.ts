import "server-only";
import { fileTypeFromBuffer } from "file-type";
import { assertPlainText, decodeText } from "./decode";
import { IngestError } from "./types";

export type DetectedKind = "text" | "zip" | "image";

export const IMAGE_MIMES = new Set(["image/png", "image/jpeg", "image/webp", "image/heic", "image/heif"]);

/**
 * Tipo real do arquivo por MAGIC BYTES (plano.md 4.1) — nunca pela extensão ou
 * pelo Content-Type enviado pelo navegador.
 */
export async function detectFileKind(buf: Buffer): Promise<{ kind: DetectedKind; mime: string }> {
  if (buf.length === 0) throw new IngestError("empty_file");
  const ft = await fileTypeFromBuffer(buf);
  if (ft) {
    if (ft.mime === "application/zip") return { kind: "zip", mime: ft.mime };
    // HEIC/HEIF não é suportado (D52): recusa já no envio, com mensagem amigável.
    if (ft.mime === "image/heic" || ft.mime === "image/heif") throw new IngestError("heic_unsupported");
    if (IMAGE_MIMES.has(ft.mime)) return { kind: "image", mime: ft.mime };
    throw new IngestError("unsupported_file_type");
  }
  // Sem assinatura binária: aceita só se for texto plausível.
  try {
    assertPlainText(decodeText(buf.subarray(0, 64 * 1024)));
  } catch {
    throw new IngestError("unsupported_file_type");
  }
  return { kind: "text", mime: "text/plain" };
}
