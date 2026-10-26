import "server-only";
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";
import { getEnv } from "@/env";

/**
 * Criptografia de campos em repouso (AES-256-GCM), plano.md 10.2.
 *
 * Formato de texto: `v1:<iv b64>:<tag b64>:<ciphertext b64>` — IV aleatório de 12 bytes
 * por valor. Para rotação, a decifragem tenta a chave atual e depois
 * `DATA_ENCRYPTION_KEY_PREVIOUS`.
 */

const VERSION = "v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const BUFFER_MAGIC = Buffer.from("PDA1");

export class DecryptionError extends Error {
  constructor() {
    super("decryption_failed");
    this.name = "DecryptionError";
  }
}

function keys(): { current: Buffer; previous?: Buffer } {
  const env = getEnv();
  return {
    current: Buffer.from(env.DATA_ENCRYPTION_KEY, "base64"),
    previous: env.DATA_ENCRYPTION_KEY_PREVIOUS
      ? Buffer.from(env.DATA_ENCRYPTION_KEY_PREVIOUS, "base64")
      : undefined,
  };
}

function encryptRaw(key: Buffer, plain: Buffer): { iv: Buffer; tag: Buffer; ct: Buffer } {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
  return { iv, tag: cipher.getAuthTag(), ct };
}

function decryptRaw(key: Buffer, iv: Buffer, tag: Buffer, ct: Buffer): Buffer {
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]);
}

function tryKeys(fn: (key: Buffer) => Buffer): { plain: Buffer; usedPrevious: boolean } {
  const { current, previous } = keys();
  try {
    return { plain: fn(current), usedPrevious: false };
  } catch {
    if (previous) {
      try {
        return { plain: fn(previous), usedPrevious: true };
      } catch {
        // cai no erro genérico abaixo
      }
    }
  }
  throw new DecryptionError();
}

export function encryptField(plain: string): string {
  const { iv, tag, ct } = encryptRaw(keys().current, Buffer.from(plain, "utf8"));
  return `${VERSION}:${iv.toString("base64")}:${tag.toString("base64")}:${ct.toString("base64")}`;
}

function parseField(value: string): { iv: Buffer; tag: Buffer; ct: Buffer } {
  const parts = value.split(":");
  if (parts.length !== 4 || parts[0] !== VERSION) throw new DecryptionError();
  const [, iv, tag, ct] = parts as [string, string, string, string];
  const ivBuf = Buffer.from(iv, "base64");
  const tagBuf = Buffer.from(tag, "base64");
  if (ivBuf.length !== IV_BYTES || tagBuf.length !== TAG_BYTES) throw new DecryptionError();
  return { iv: ivBuf, tag: tagBuf, ct: Buffer.from(ct, "base64") };
}

export function decryptField(value: string): string {
  const { iv, tag, ct } = parseField(value);
  return tryKeys((key) => decryptRaw(key, iv, tag, ct)).plain.toString("utf8");
}

/** Valor no formato cifrado do projeto (`v1:iv:tag:ct`)? */
export function looksEncrypted(value: string): boolean {
  return value.startsWith(`${VERSION}:`) && value.split(":").length === 4;
}

/**
 * Para colunas que passaram a ser cifradas depois (ex.: `report_sections.locked_title`,
 * D83): decifra se estiver cifrado; linhas antigas em texto puro são devolvidas como estão
 * (e cifradas pelo job de rotação de chave).
 */
export function decryptLegacyField(value: string): string {
  return looksEncrypted(value) ? decryptField(value) : value;
}

export function encryptNullable(plain: string | null | undefined): string | null {
  return plain === null || plain === undefined ? null : encryptField(plain);
}

export function decryptNullable(value: string | null | undefined): string | null {
  return value === null || value === undefined ? null : decryptField(value);
}

export function encryptJson(value: unknown): string {
  return encryptField(JSON.stringify(value));
}

export function decryptJson(value: string): unknown {
  return JSON.parse(decryptField(value)) as unknown;
}

/** true se o valor foi cifrado com a chave anterior (precisa ser re-cifrado na rotação). */
export function isEncryptedWithPreviousKey(value: string): boolean {
  const { iv, tag, ct } = parseField(value);
  return tryKeys((key) => decryptRaw(key, iv, tag, ct)).usedPrevious;
}

/** Re-cifra com a chave atual (rotação). */
export function reencryptField(value: string): string {
  return encryptField(decryptField(value));
}

// ---------------------------------------------------------------- buffers (arquivos)
export function encryptBuffer(plain: Buffer): Buffer {
  const { iv, tag, ct } = encryptRaw(keys().current, plain);
  return Buffer.concat([BUFFER_MAGIC, iv, tag, ct]);
}

export function decryptBuffer(data: Buffer): Buffer {
  if (data.length < BUFFER_MAGIC.length + IV_BYTES + TAG_BYTES) throw new DecryptionError();
  if (!data.subarray(0, BUFFER_MAGIC.length).equals(BUFFER_MAGIC)) throw new DecryptionError();
  let o = BUFFER_MAGIC.length;
  const iv = data.subarray(o, (o += IV_BYTES));
  const tag = data.subarray(o, (o += TAG_BYTES));
  const ct = data.subarray(o);
  return tryKeys((key) => decryptRaw(key, iv, tag, ct)).plain;
}

// ---------------------------------------------------------------- hashes e tokens
export function sha256Hex(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

/** Hash com pepper para IP/e-mail (rate limit, consentimentos). Não reversível. */
export function pepperedHash(value: string): string {
  return createHmac("sha256", getEnv().HASH_PEPPER).update(value).digest("hex");
}

/** Hash de tokens de sessão/link mágico (assinado com SESSION_SECRET). */
export function tokenHash(token: string): string {
  return createHmac("sha256", getEnv().SESSION_SECRET).update(token).digest("hex");
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}
