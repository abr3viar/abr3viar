import "server-only";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { assertSafeKey, type Storage } from "./types";

export class LocalStorage implements Storage {
  private readonly root: string;

  constructor(dir: string) {
    this.root = path.resolve(dir);
  }

  private resolve(key: string): string {
    assertSafeKey(key);
    const full = path.resolve(this.root, key);
    if (!full.startsWith(this.root + path.sep)) throw new Error("invalid_storage_key");
    return full;
  }

  async put(key: string, data: Buffer): Promise<void> {
    const full = this.resolve(key);
    await mkdir(path.dirname(full), { recursive: true, mode: 0o700 });
    await writeFile(full, data, { mode: 0o600 });
  }

  async get(key: string): Promise<Buffer> {
    return readFile(this.resolve(key));
  }

  async delete(key: string): Promise<void> {
    await rm(this.resolve(key), { force: true });
  }

  async deletePrefix(prefix: string): Promise<void> {
    const clean = prefix.replace(/\/+$/, "");
    await rm(this.resolve(clean), { recursive: true, force: true });
  }

  async list(prefix: string): Promise<{ key: string; lastModified: Date }[]> {
    const out: { key: string; lastModified: Date }[] = [];
    const base = this.resolve(prefix.replace(/\/+$/, ""));
    const walk = async (dir: string): Promise<void> => {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) await walk(full);
        else if (entry.isFile()) {
          const s = await stat(full);
          out.push({ key: path.relative(this.root, full).split(path.sep).join("/"), lastModified: s.mtime });
        }
      }
    };
    await walk(base);
    return out;
  }

  async ping(): Promise<void> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
  }
}
