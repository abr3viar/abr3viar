import "server-only";
import { getEnv } from "@/env";
import { decryptBuffer, encryptBuffer } from "@/server/crypto";
import { LocalStorage } from "./local";
import type { Storage } from "./types";

export type { Storage } from "./types";

const holder = globalThis as unknown as { __pdaStorage?: Storage };

export async function getStorage(): Promise<Storage> {
  if (holder.__pdaStorage) return holder.__pdaStorage;
  const env = getEnv();
  if (env.STORAGE_DRIVER === "s3") {
    const { S3Storage } = await import("./s3");
    holder.__pdaStorage = new S3Storage({
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION,
      bucket: env.S3_BUCKET!,
      accessKeyId: env.S3_ACCESS_KEY_ID!,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY!,
    });
  } else {
    holder.__pdaStorage = new LocalStorage(env.STORAGE_LOCAL_DIR);
  }
  return holder.__pdaStorage;
}

/** Só para testes. */
export function setStorageForTests(storage: Storage | undefined): void {
  holder.__pdaStorage = storage;
}

/** Arquivos originais são cifrados na aplicação antes de ir para o storage. */
export async function putEncrypted(key: string, data: Buffer): Promise<void> {
  await (await getStorage()).put(key, encryptBuffer(data));
}

export async function getDecrypted(key: string): Promise<Buffer> {
  return decryptBuffer(await (await getStorage()).get(key));
}

export function uploadPrefix(conversationId: string): string {
  return `uploads/${conversationId}/`;
}
