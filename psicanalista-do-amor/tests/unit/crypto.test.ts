import { describe, expect, it, beforeEach } from "vitest";
import {
  decryptBuffer,
  decryptField,
  decryptJson,
  DecryptionError,
  encryptBuffer,
  encryptField,
  encryptJson,
  isEncryptedWithPreviousKey,
  pepperedHash,
  reencryptField,
  tokenHash,
} from "@/server/crypto";
import { resetEnvCache } from "@/env";

const KEY_A = Buffer.alloc(32, 7).toString("base64");
const KEY_B = Buffer.alloc(32, 9).toString("base64");

describe("crypto (AES-256-GCM)", () => {
  beforeEach(() => {
    process.env.DATA_ENCRYPTION_KEY = KEY_A;
    delete process.env.DATA_ENCRYPTION_KEY_PREVIOUS;
    resetEnvCache();
  });

  it("cifra e decifra texto com acentos e emojis", () => {
    const plain = "Você sumiu hoje 😢 — tá tudo bem?";
    const ct = encryptField(plain);
    expect(ct.startsWith("v1:")).toBe(true);
    expect(ct).not.toContain("sumiu");
    expect(decryptField(ct)).toBe(plain);
  });

  it("usa IV aleatório (mesmo texto gera cifras diferentes)", () => {
    expect(encryptField("oi")).not.toBe(encryptField("oi"));
  });

  it("detecta adulteração (tag GCM)", () => {
    const ct = encryptField("segredo");
    const parts = ct.split(":");
    const body = Buffer.from(parts[3]!, "base64");
    body[0] = body[0]! ^ 0xff;
    parts[3] = body.toString("base64");
    expect(() => decryptField(parts.join(":"))).toThrow(DecryptionError);
  });

  it("rejeita formato inválido", () => {
    expect(() => decryptField("texto puro")).toThrow(DecryptionError);
    expect(() => decryptField("v2:a:b:c")).toThrow(DecryptionError);
  });

  it("cifra JSON", () => {
    const value = [{ seq: 3, quote: "oi" }];
    expect(decryptJson(encryptJson(value))).toEqual(value);
  });

  it("cifra buffers (arquivos)", () => {
    const data = Buffer.from("conteúdo do arquivo");
    const enc = encryptBuffer(data);
    expect(enc.includes(data)).toBe(false);
    expect(decryptBuffer(enc).equals(data)).toBe(true);
  });

  it("rotação: decifra com a chave anterior e re-cifra com a nova", () => {
    const old = encryptField("mensagem antiga");
    process.env.DATA_ENCRYPTION_KEY = KEY_B;
    process.env.DATA_ENCRYPTION_KEY_PREVIOUS = KEY_A;
    resetEnvCache();
    expect(decryptField(old)).toBe("mensagem antiga");
    expect(isEncryptedWithPreviousKey(old)).toBe(true);
    const fresh = reencryptField(old);
    expect(isEncryptedWithPreviousKey(fresh)).toBe(false);
    delete process.env.DATA_ENCRYPTION_KEY_PREVIOUS;
    resetEnvCache();
    expect(decryptField(fresh)).toBe("mensagem antiga");
    expect(() => decryptField(old)).toThrow(DecryptionError);
  });

  it("hashes são determinísticos e não revelam a entrada", () => {
    expect(pepperedHash("1.2.3.4")).toBe(pepperedHash("1.2.3.4"));
    expect(pepperedHash("1.2.3.4")).not.toContain("1.2.3.4");
    expect(tokenHash("abc")).toHaveLength(64);
  });
});
