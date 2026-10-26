import sharp from "sharp";

/** Gera "prints" FICTÍCIAS por código (sem nenhuma conversa real). */
export async function fakeScreenshot(opts: { width?: number; height?: number; color?: string; seed?: number; exifOrientation?: number; withGps?: boolean; format?: "png" | "jpeg" } = {}): Promise<Buffer> {
  const width = opts.width ?? 400;
  const height = opts.height ?? 800;
  const seed = opts.seed ?? 1;
  const bubbles = Array.from({ length: 6 }, (_, i) => {
    const right = (i + seed) % 2 === 0;
    const y = 40 + i * 120 + (seed % 5) * 7;
    const w = 120 + ((seed * 37 + i * 53) % 160);
    const x = right ? width - w - 20 : 20;
    return `<rect x="${x}" y="${y}" width="${w}" height="70" rx="14" fill="${right ? "#d9fdd3" : "#ffffff"}"/>`;
  }).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="${opts.color ?? "#efeae2"}"/>${bubbles}</svg>`;
  let img = sharp(Buffer.from(svg));
  if (opts.format === "jpeg" || opts.exifOrientation || opts.withGps) {
    img = img.jpeg().withMetadata({
      orientation: opts.exifOrientation,
      exif: opts.withGps ? { IFD0: { Copyright: "EXIF-DE-TESTE" }, IFD3: { GPSLatitudeRef: "S", GPSLongitudeRef: "W" } } : undefined,
    });
    return img.toBuffer();
  }
  return img.png().toBuffer();
}
