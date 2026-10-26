import { describe, expect, it } from "vitest";
import type { S3Client } from "@aws-sdk/client-s3";
import { S3Storage } from "@/server/storage/s3";

/** Cliente S3 FALSO em memória (nenhuma chamada de rede). */
function fakeClient() {
  const store = new Map<string, Buffer>();
  const calls: string[] = [];
  const client = {
    async send(cmd: { constructor: { name: string }; input: Record<string, unknown> }) {
      const name = cmd.constructor.name;
      calls.push(name);
      const input = cmd.input;
      switch (name) {
        case "PutObjectCommand":
          store.set(input.Key as string, input.Body as Buffer);
          return {};
        case "GetObjectCommand": {
          const body = store.get(input.Key as string);
          if (!body) throw Object.assign(new Error("NoSuchKey"), { name: "NoSuchKey" });
          return { Body: { transformToByteArray: async () => new Uint8Array(body) } };
        }
        case "DeleteObjectCommand":
          store.delete(input.Key as string);
          return {};
        case "ListObjectsV2Command":
          return {
            Contents: [...store.keys()].filter((k) => k.startsWith(input.Prefix as string)).map((Key) => ({ Key, LastModified: new Date() })),
            IsTruncated: false,
          };
        case "DeleteObjectsCommand":
          for (const o of (input.Delete as { Objects: { Key: string }[] }).Objects) store.delete(o.Key);
          return {};
        case "HeadBucketCommand":
          return {};
      }
      throw new Error(`comando inesperado ${name}`);
    },
  };
  return { client: client as unknown as S3Client, store, calls };
}

describe("driver S3/R2", () => {
  const config = { region: "auto", bucket: "b", accessKeyId: "x", secretAccessKey: "y", endpoint: "https://r2.example.com" };

  it("put/get/delete/list/deletePrefix", async () => {
    const { client, store } = fakeClient();
    const s3 = new S3Storage(config, client);
    await s3.put("uploads/c1/a", Buffer.from("A"));
    await s3.put("uploads/c1/b", Buffer.from("B"));
    await s3.put("uploads/c2/a", Buffer.from("C"));
    expect((await s3.get("uploads/c1/a")).toString()).toBe("A");
    expect((await s3.list("uploads/c1/")).map((o) => o.key).sort()).toEqual(["uploads/c1/a", "uploads/c1/b"]);
    await s3.deletePrefix("uploads/c1/");
    expect([...store.keys()]).toEqual(["uploads/c2/a"]);
    await s3.delete("uploads/c2/a");
    expect(store.size).toBe(0);
    await s3.ping();
  });

  it("recusa chaves perigosas", async () => {
    const s3 = new S3Storage(config, fakeClient().client);
    for (const key of ["../x", "/abs", "a//b", "a/../b"]) {
      await expect(s3.put(key, Buffer.from("x"))).rejects.toThrow("invalid_storage_key");
    }
  });
});
