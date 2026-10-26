import "server-only";
import yauzl, { type Entry, type ZipFile } from "yauzl";
import { IngestError } from "./types";

/**
 * Leitura SEGURA de .zip (plano.md 4.4 e 10.3), em memória e em streaming com yauzl:
 * - no máximo 200 entradas e 100 MB descompactados (declarados E reais);
 * - rejeita caminhos absolutos, `..`, `\`, bytes nulos e links simbólicos;
 * - rejeita razão de compressão > 100:1 por entrada;
 * - conta os bytes REAIS durante a descompressão e aborta ao passar do limite;
 * - ignora zip dentro de zip, `__MACOSX/`, `.DS_Store` e `Thumbs.db`;
 * - nunca usa o nome do arquivo como caminho (nada é gravado em disco).
 */

export const ZIP_LIMITS = {
  maxEntries: 200,
  maxTotalUncompressed: 100 * 1024 * 1024,
  maxRatio: 100,
  maxEntryBytes: 50 * 1024 * 1024,
};

export type ZipItem = { name: string; data: Buffer };

const IGNORED = [/^__MACOSX\//i, /(^|\/)\.DS_Store$/i, /(^|\/)Thumbs\.db$/i, /(^|\/)desktop\.ini$/i];
const S_IFMT = 0o170000;
const S_IFLNK = 0o120000;

export function isUnsafeName(name: string): boolean {
  if (name.includes("\0") || name.includes("\\")) return true;
  if (name.startsWith("/") || /^[a-zA-Z]:/.test(name)) return true;
  return name.split("/").some((part) => part === "..");
}

function isSymlink(entry: Entry): boolean {
  const unixMode = (entry.externalFileAttributes >>> 16) & 0xffff;
  return (unixMode & S_IFMT) === S_IFLNK;
}

function open(buf: Buffer): Promise<ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(
      buf,
      { lazyEntries: true, autoClose: false, decodeStrings: true, validateEntrySizes: true, strictFileNames: true },
      (err, zip) => (err || !zip ? reject(new IngestError("zip_invalid")) : resolve(zip)),
    );
  });
}

function listEntries(zip: ZipFile): Promise<Entry[]> {
  return new Promise((resolve, reject) => {
    const entries: Entry[] = [];
    zip.on("entry", (e: Entry) => {
      entries.push(e);
      if (entries.length > ZIP_LIMITS.maxEntries) {
        reject(new IngestError("zip_too_many_entries"));
        return;
      }
      zip.readEntry();
    });
    zip.on("end", () => resolve(entries));
    zip.on("error", (err: Error) => {
      // yauzl rejeita sozinho nomes inválidos (absolutos, "..") — tratamos como suspeito.
      reject(new IngestError(/file name|path/i.test(err.message) ? "zip_suspicious" : "zip_invalid"));
    });
    zip.readEntry();
  });
}

function readEntry(zip: ZipFile, entry: Entry, budget: { remaining: number }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (err, stream) => {
      if (err || !stream) return reject(new IngestError("zip_invalid"));
      const chunks: Buffer[] = [];
      let size = 0;
      stream.on("data", (chunk: Buffer) => {
        size += chunk.length;
        budget.remaining -= chunk.length;
        if (size > ZIP_LIMITS.maxEntryBytes || budget.remaining < 0 || size > entry.uncompressedSize) {
          stream.destroy();
          reject(new IngestError("zip_too_large"));
          return;
        }
        chunks.push(chunk);
      });
      stream.on("error", () => reject(new IngestError("zip_suspicious")));
      stream.on("end", () => resolve(Buffer.concat(chunks)));
    });
  });
}

/**
 * Lê o zip e devolve só as entradas aceitas por `accept` (já com os bytes).
 * `accept` recebe o nome NORMALIZADO apenas para classificação (nunca vira caminho).
 */
export async function readZipSafely(buf: Buffer, accept: (name: string) => boolean): Promise<ZipItem[]> {
  const zip = await open(buf);
  try {
    if (zip.entryCount > ZIP_LIMITS.maxEntries) throw new IngestError("zip_too_many_entries");
    const entries = await listEntries(zip);

    let declaredTotal = 0;
    const chosen: Entry[] = [];
    for (const e of entries) {
      const name = e.fileName;
      if (isUnsafeName(name) || isSymlink(e)) throw new IngestError("zip_suspicious");
      if (e.isEncrypted()) throw new IngestError("zip_invalid");
      if (name.endsWith("/")) continue; // diretório
      declaredTotal += e.uncompressedSize;
      if (declaredTotal > ZIP_LIMITS.maxTotalUncompressed) throw new IngestError("zip_too_large");
      if (e.uncompressedSize > 0 && e.uncompressedSize / Math.max(1, e.compressedSize) > ZIP_LIMITS.maxRatio) {
        throw new IngestError("zip_suspicious");
      }
      if (IGNORED.some((re) => re.test(name))) continue;
      if (/\.zip$/i.test(name)) continue; // zip aninhado: ignorado (não recursivo)
      if (!accept(name)) continue;
      chosen.push(e);
    }

    const budget = { remaining: ZIP_LIMITS.maxTotalUncompressed };
    const items: ZipItem[] = [];
    for (const e of chosen) {
      const data = await readEntry(zip, e, budget);
      // Zip dentro de zip renomeado: ignorado também.
      if (data.length >= 4 && data.readUInt32LE(0) === 0x04034b50) continue;
      items.push({ name: e.fileName, data });
    }
    return items;
  } finally {
    zip.close();
  }
}

const collator = new Intl.Collator("pt-BR", { numeric: true, sensitivity: "base" });

/** Ordenação natural: Screenshot_2.png antes de Screenshot_10.png. */
export function naturalSort<T extends { name: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => collator.compare(a.name, b.name));
}
