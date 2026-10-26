import "server-only";
import sharp from "sharp";
import { IngestError } from "./types";

/**
 * Pré-processamento das prints (plano.md 4.5 e 10.3):
 * - rotaciona conforme EXIF e RE-ENCODA em JPEG (remove EXIF/GPS e qualquer payload);
 * - limita o lado maior a ~2000 px (economiza tokens e respeita o limite de 20 MB);
 * - `limitInputPixels` contra "pixel flood";
 * - hash perceptual (dHash 64 bits) para descartar prints duplicadas.
 */

export const MAX_SIDE = 2000;
export const MAX_INPUT_PIXELS = 50_000_000;

export type PreparedImage = { data: Buffer; width: number; height: number; hash: bigint };

sharp.cache(false);
sharp.concurrency(1);

export async function prepareImage(input: Buffer): Promise<PreparedImage> {
  try {
    const pipeline = sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, failOn: "error", animated: false })
      .rotate()
      .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" });
    const { data, info } = await pipeline.jpeg({ quality: 82, mozjpeg: true }).toBuffer({ resolveWithObject: true });
    return { data, width: info.width, height: info.height, hash: await dHash(data) };
  } catch (err) {
    if (err instanceof IngestError) throw err;
    const msg = err instanceof Error ? err.message : "";
    if (/heif|heic|compression format/i.test(msg)) throw new IngestError("heic_unsupported");
    if (/pixel limit/i.test(msg)) throw new IngestError("image_too_large");
    throw new IngestError("image_invalid");
  }
}

/**
 * dHash de 1024 bits: compara pixels vizinhos numa miniatura 33x32 em tons de cinza.
 * Prints da mesma conversa são muito parecidas entre si, então o hash clássico de
 * 64 bits confundiria prints diferentes; com 1024 bits só as repetidas ficam próximas.
 */
const HASH_W = 32;
const HASH_H = 32;
export async function dHash(input: Buffer): Promise<bigint> {
  const raw = await sharp(input).grayscale().resize(HASH_W + 1, HASH_H, { fit: "fill" }).raw().toBuffer();
  let hash = 0n;
  for (let y = 0; y < HASH_H; y++) {
    for (let x = 0; x < HASH_W; x++) {
      const left = raw[y * (HASH_W + 1) + x]!;
      const right = raw[y * (HASH_W + 1) + x + 1]!;
      hash = (hash << 1n) | (left > right + 2 ? 1n : 0n);
    }
  }
  return hash;
}

export function hamming(a: bigint, b: bigint): number {
  let x = a ^ b;
  let count = 0;
  while (x) {
    count += Number(x & 1n);
    x >>= 1n;
  }
  return count;
}

/** Remove prints duplicadas (mesmo hash perceptual), mantendo a ordem. */
export function dedupeImages<T extends { hash: bigint }>(images: T[], threshold = 12): { kept: T[]; removed: number } {
  const kept: T[] = [];
  for (const img of images) {
    if (kept.some((k) => hamming(k.hash, img.hash) <= threshold)) continue;
    kept.push(img);
  }
  return { kept, removed: images.length - kept.length };
}
