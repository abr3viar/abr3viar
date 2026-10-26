import type { Storage } from "@/server/storage/types";

export class MemoryStorage implements Storage {
  readonly objects = new Map<string, { data: Buffer; lastModified: Date }>();
  async put(key: string, data: Buffer) {
    this.objects.set(key, { data, lastModified: new Date() });
  }
  async get(key: string) {
    const o = this.objects.get(key);
    if (!o) throw new Error("not found");
    return o.data;
  }
  async delete(key: string) {
    this.objects.delete(key);
  }
  async deletePrefix(prefix: string) {
    for (const k of [...this.objects.keys()]) if (k.startsWith(prefix)) this.objects.delete(k);
  }
  async list(prefix: string) {
    return [...this.objects.entries()].filter(([k]) => k.startsWith(prefix)).map(([key, o]) => ({ key, lastModified: o.lastModified }));
  }
  async ping() {}
}
