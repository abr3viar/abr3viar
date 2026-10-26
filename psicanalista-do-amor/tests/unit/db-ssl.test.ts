import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resetEnvCache } from "@/env";
import { connectionString, splitPem, sslOption } from "@/server/db/client";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 1024 });
const KEY = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const CERT = "-----BEGIN CERTIFICATE-----\nMIIBfakecertificate\n-----END CERTIFICATE-----";

afterEach(() => {
  for (const k of ["DATABASE_SSL", "DATABASE_SSL_CERT_BASE64", "DATABASE_SSL_CA_BASE64", "DATABASE_URL_CERT_PATH"]) delete process.env[k];
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://invalid:invalid@127.0.0.1:1/none";
  resetEnvCache();
});

describe("TLS do Postgres (Square Cloud: certificado de cliente)", () => {
  it("separa chave e certificado de um PEM combinado", () => {
    const { key, cert } = splitPem(`${KEY}\n${CERT}\n`);
    expect(key).toContain("PRIVATE KEY");
    expect(cert).toContain("BEGIN CERTIFICATE");
    expect(cert).not.toContain("PRIVATE");
  });

  it("monta ssl com chave+certificado, sem verificar o servidor só com no-verify explícito, e limpa sslmode da URL", () => {
    process.env.DATABASE_URL = "postgresql://u:p@db.example.com:7000/squarecloud?sslmode=require";
    process.env.DATABASE_SSL_CERT_BASE64 = Buffer.from(`${KEY}\n${CERT}`).toString("base64");
    process.env.DATABASE_SSL = "no-verify";
    resetEnvCache();
    const ssl = sslOption() as { key: string; cert: string; rejectUnauthorized: boolean };
    expect(ssl.key).toContain("PRIVATE KEY");
    expect(ssl.cert).toContain("CERTIFICATE");
    expect(ssl.rejectUnauthorized).toBe(false);
    expect(connectionString()).toBe("postgresql://u:p@db.example.com:7000/squarecloud");
  });

  it("certificado de cliente sem DATABASE_SSL verifica o servidor (padrão seguro)", () => {
    process.env.DATABASE_SSL_CERT_BASE64 = Buffer.from(`${KEY}\n${CERT}`).toString("base64");
    resetEnvCache();
    expect((sslOption() as { rejectUnauthorized: boolean }).rejectUnauthorized).toBe(true);
  });

  it("URL com sslmode=verify-full continua verificando mesmo com no-verify", () => {
    process.env.DATABASE_URL = "postgresql://u:p@db.example.com:7000/x?sslmode=verify-full";
    process.env.DATABASE_SSL = "no-verify";
    resetEnvCache();
    expect((sslOption() as { rejectUnauthorized: boolean }).rejectUnauthorized).toBe(true);
  });

  it("com CA informada, verifica o servidor", () => {
    process.env.DATABASE_SSL_CA_BASE64 = Buffer.from(CERT).toString("base64");
    resetEnvCache();
    expect((sslOption() as { rejectUnauthorized: boolean }).rejectUnauthorized).toBe(true);
  });

  it("lê o certificado de um arquivo (formato do MCP da Square Cloud: DATABASE_URL_CERT_PATH)", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "pda-cert-"));
    const file = path.join(dir, "certificate.pem");
    writeFileSync(file, `${KEY}\n${CERT}\n`);
    process.env.DATABASE_URL_CERT_PATH = file;
    process.env.DATABASE_SSL = "no-verify";
    resetEnvCache();
    const ssl = sslOption() as { key: string; cert: string; rejectUnauthorized: boolean };
    expect(ssl.key).toContain("PRIVATE KEY");
    expect(ssl.cert).toContain("CERTIFICATE");
    expect(ssl.rejectUnauthorized).toBe(false);
  });

  it("arquivo do certificado ausente: erro só com o nome da variável", () => {
    process.env.DATABASE_URL_CERT_PATH = "nao-existe/certificate.pem";
    resetEnvCache();
    expect(() => sslOption()).toThrow(/^DATABASE_URL_CERT_PATH: /);
    expect(() => sslOption()).not.toThrow(/nao-existe/);
  });

  it("sem configuração de TLS, usa a URL como está", () => {
    process.env.DATABASE_URL = "postgres://a:b@localhost:5432/x?sslmode=disable";
    resetEnvCache();
    expect(sslOption()).toBeUndefined();
    expect(connectionString()).toBe("postgres://a:b@localhost:5432/x?sslmode=disable");
  });
});
