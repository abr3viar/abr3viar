import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { dedupeImages, hamming, prepareImage, MAX_SIDE } from "@/server/ingest/images";
import { detectFileKind } from "@/server/ingest/detect";
import { IngestError } from "@/server/ingest/types";
import { fakeScreenshot } from "../helpers/images";

describe("pré-processamento de prints (sharp)", () => {
  it("remove EXIF/GPS e re-encoda em JPEG", async () => {
    const input = await fakeScreenshot({ withGps: true });
    const before = await sharp(input).metadata();
    expect(before.exif).toBeDefined();
    const out = await prepareImage(input);
    const after = await sharp(out.data).metadata();
    expect(after.format).toBe("jpeg");
    expect(after.exif).toBeUndefined();
    expect(out.data.includes(Buffer.from("EXIF-DE-TESTE"))).toBe(false);
  });

  it("rotaciona conforme a orientação EXIF", async () => {
    const input = await fakeScreenshot({ width: 400, height: 800, exifOrientation: 6 });
    const out = await prepareImage(input);
    expect(out.width).toBe(800);
    expect(out.height).toBe(400);
  });

  it("limita o lado maior a 2000 px", async () => {
    const out = await prepareImage(await fakeScreenshot({ width: 1200, height: 4000 }));
    expect(Math.max(out.width, out.height)).toBe(MAX_SIDE);
  });

  it("recusa imagem inválida com erro amigável", async () => {
    const err = await prepareImage(Buffer.from("não é imagem")).catch((e: unknown) => e);
    expect((err as IngestError).code).toBe("image_invalid");
  });

  it("descarta prints duplicadas pelo hash perceptual", async () => {
    const a = await prepareImage(await fakeScreenshot({ seed: 1 }));
    const a2 = await prepareImage(await fakeScreenshot({ seed: 1, format: "jpeg" }));
    const b = await prepareImage(await fakeScreenshot({ seed: 2 }));
    expect(hamming(a.hash, a2.hash)).toBeLessThanOrEqual(12);
    expect(hamming(a.hash, b.hash)).toBeGreaterThan(12);
    const { kept, removed } = dedupeImages([a, a2, b]);
    expect(kept).toHaveLength(2);
    expect(removed).toBe(1);
  });

  it("detecta tipo por magic bytes, não pela extensão", async () => {
    expect((await detectFileKind(await fakeScreenshot())).mime).toBe("image/png");
    expect((await detectFileKind(Buffer.from("23/10/2026 14:05 - Ana: oi"))).kind).toBe("text");
    const exe = Buffer.concat([Buffer.from([0x4d, 0x5a, 0x90, 0x00]), Buffer.alloc(200)]);
    expect(((await detectFileKind(exe).catch((e: unknown) => e)) as IngestError).code).toBe("unsupported_file_type");
    const pdf = Buffer.from("%PDF-1.4\n%âãÏÓ\n1 0 obj");
    expect(((await detectFileKind(pdf).catch((e: unknown) => e)) as IngestError).code).toBe("unsupported_file_type");
  });
});
