import { describe, expect, it } from "vitest";
import { naturalSort, readZipSafely, isUnsafeName, ZIP_LIMITS } from "@/server/ingest/zip";
import { IngestError } from "@/server/ingest/types";
import { buildZip } from "../helpers/zip";

const all = () => true;
const code = async (p: Promise<unknown>) => ((await p.catch((e: unknown) => e)) as IngestError).code;

describe("leitura segura de .zip", () => {
  it("lê entradas normais (stored e deflate)", async () => {
    const zip = buildZip([
      { name: "_chat.txt", data: Buffer.from("23/10/2026 14:05 - Ana: oi") , deflate: true },
      { name: "pasta/IMG_1.png", data: Buffer.from("png") },
    ]);
    const items = await readZipSafely(zip, all);
    expect(items.map((i) => i.name)).toEqual(["_chat.txt", "pasta/IMG_1.png"]);
    expect(items[0]!.data.toString()).toContain("Ana: oi");
  });

  it("rejeita path traversal, caminho absoluto, barra invertida e byte nulo", async () => {
    for (const name of ["../evil.txt", "a/../../evil.txt", "/etc/passwd", "C:/win.txt", "a\\b.txt"]) {
      const c = await code(readZipSafely(buildZip([{ name, data: Buffer.from("x") }]), all));
      expect(c, name).toMatch(/zip_suspicious|zip_invalid/);
    }
    expect(isUnsafeName("ok/arquivo.txt")).toBe(false);
    expect(isUnsafeName("x\0y")).toBe(true);
  });

  it("rejeita links simbólicos", async () => {
    const zip = buildZip([{ name: "link", data: Buffer.from("/etc/passwd"), externalAttrs: (0o120777 << 16) >>> 0 }]);
    expect(await code(readZipSafely(zip, all))).toBe("zip_suspicious");
  });

  it("zip bomb: razão de compressão > 100:1", async () => {
    const zip = buildZip([{ name: "bomba.txt", data: Buffer.alloc(5 * 1024 * 1024, 0), deflate: true }]);
    expect(await code(readZipSafely(zip, all))).toBe("zip_suspicious");
  });

  it("zip bomb: tamanho declarado mentiroso é pego pela contagem de bytes reais", async () => {
    const data = Buffer.from("a".repeat(5000) + "b".repeat(5000));
    const zip = buildZip([{ name: "mentira.txt", data, deflate: true, declaredSize: 9000 }]);
    expect(await code(readZipSafely(zip, all))).toMatch(/zip_too_large|zip_suspicious/);
  });

  it("muitas entradas e total descompactado grande demais", async () => {
    const many = buildZip(Array.from({ length: ZIP_LIMITS.maxEntries + 1 }, (_, i) => ({ name: `f${i}.txt`, data: Buffer.from("x") })));
    expect(await code(readZipSafely(many, all))).toBe("zip_too_many_entries");
    const original = ZIP_LIMITS.maxTotalUncompressed;
    ZIP_LIMITS.maxTotalUncompressed = 1024 * 1024;
    try {
      const rnd = () => Buffer.from(Array.from({ length: 700 * 1024 }, () => Math.floor(Math.random() * 256)));
      const big = buildZip([
        { name: "a.bin", data: rnd() },
        { name: "b.bin", data: rnd() },
      ]);
      expect(await code(readZipSafely(big, all))).toBe("zip_too_large");
    } finally {
      ZIP_LIMITS.maxTotalUncompressed = original;
    }
  });

  it("zip protegido por senha e zip corrompido → erro amigável", async () => {
    const enc = buildZip([{ name: "a.txt", data: Buffer.from("x"), encryptedFlag: true }]);
    expect(await code(readZipSafely(enc, all))).toBe("zip_invalid");
    expect(await code(readZipSafely(Buffer.from("PK\u0003\u0004 lixo"), all))).toBe("zip_invalid");
  });

  it("ignora zip aninhado, __MACOSX, .DS_Store e Thumbs.db", async () => {
    const inner = buildZip([{ name: "x.txt", data: Buffer.from("x") }]);
    const zip = buildZip([
      { name: "interno.zip", data: inner },
      { name: "renomeado.png", data: inner },
      { name: "__MACOSX/._a.png", data: Buffer.from("x") },
      { name: "fotos/.DS_Store", data: Buffer.from("x") },
      { name: "Thumbs.db", data: Buffer.from("x") },
      { name: "a.png", data: Buffer.from("png") },
    ]);
    const items = await readZipSafely(zip, all);
    expect(items.map((i) => i.name)).toEqual(["a.png"]);
  });

  it("ordenação natural dos nomes", () => {
    const sorted = naturalSort([{ name: "Screenshot_10.png" }, { name: "Screenshot_2.png" }, { name: "Screenshot_1.png" }]);
    expect(sorted.map((s) => s.name)).toEqual(["Screenshot_1.png", "Screenshot_2.png", "Screenshot_10.png"]);
  });
});
