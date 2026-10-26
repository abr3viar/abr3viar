import "server-only";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import { getEnv } from "@/env";
import { log } from "@/server/log";
import * as schema from "./schema";

export type Db = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

type Holder = { pool?: pg.Pool; db?: Db };
const holder = globalThis as unknown as { __pdaDb?: Holder };
holder.__pdaDb ??= {};

const PEM_BLOCK = /-----BEGIN ([A-Z0-9 ]+)-----[\s\S]+?-----END \1-----/g;

/** Separa um PEM combinado (chave privada + certificado) nos blocos de chave e certificado. */
export function splitPem(pem: string): { key?: string; cert?: string } {
  const blocks = [...pem.matchAll(PEM_BLOCK)].map((m) => ({ label: m[1]!, text: m[0] }));
  const key = blocks.filter((b) => /PRIVATE KEY/.test(b.label)).map((b) => b.text).join("\n");
  const cert = blocks.filter((b) => b.label === "CERTIFICATE").map((b) => b.text).join("\n");
  return { key: key || undefined, cert: cert || undefined };
}

const decodeB64 = (v: string) => Buffer.from(v.replace(/\s+/g, ""), "base64").toString("utf8");

/** PEM do certificado de cliente: base64 na variável ou arquivo do app (DATABASE_URL_CERT_PATH). */
function clientPem(env: ReturnType<typeof getEnv>): string | null {
  if (env.DATABASE_SSL_CERT_BASE64) return decodeB64(env.DATABASE_SSL_CERT_BASE64);
  if (!env.DATABASE_URL_CERT_PATH) return null;
  const file = path.resolve(process.cwd(), env.DATABASE_URL_CERT_PATH);
  try {
    return readFileSync(file, "utf8");
  } catch {
    // Só o nome da variável: o caminho pode revelar a estrutura do servidor, e o conteúdo é segredo.
    throw new Error("DATABASE_URL_CERT_PATH: o arquivo do certificado não foi encontrado na raiz do app");
  }
}

/** `sslmode` pedido na própria DATABASE_URL (minúsculo), se houver. */
export function urlSslMode(databaseUrl: string): string | undefined {
  try {
    return new URL(databaseUrl).searchParams.get("sslmode")?.toLowerCase() ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * Opções de TLS do Postgres. Suporta certificado de CLIENTE (o Postgres da Square Cloud
 * entrega um PEM com chave + certificado) e CA opcional para verificar o servidor.
 * O servidor só deixa de ser verificado com `DATABASE_SSL=no-verify` EXPLÍCITO (e nunca
 * se a URL pedir `verify-ca`/`verify-full` ou se houver CA).
 */
export function sslOption(): pg.PoolConfig["ssl"] {
  const env = getEnv();
  const mode = env.DATABASE_SSL;
  if (mode === "disable") return false;
  const pem = clientPem(env);
  const client = pem ? splitPem(pem) : {};
  const ca = env.DATABASE_SSL_CA_BASE64 ? decodeB64(env.DATABASE_SSL_CA_BASE64) : undefined;
  if (!mode && !client.cert && !ca) return undefined;
  const urlVerify = /^verify-(ca|full)$/.test(urlSslMode(env.DATABASE_URL) ?? "");
  return {
    rejectUnauthorized: Boolean(ca) || urlVerify || mode !== "no-verify",
    ...(ca ? { ca } : {}),
    ...(client.key ? { key: client.key } : {}),
    ...(client.cert ? { cert: client.cert } : {}),
  };
}

/**
 * Connection string sem parâmetros sslmode/sslcert/... quando o TLS é configurado pelas
 * variáveis acima (no node-postgres, os parâmetros da URL sobrescreveriam o objeto `ssl`).
 */
export function connectionString(): string {
  const env = getEnv();
  if (sslOption() === undefined) return env.DATABASE_URL;
  try {
    const url = new URL(env.DATABASE_URL);
    for (const p of ["sslmode", "ssl", "sslcert", "sslkey", "sslrootcert", "uselibpqcompat"]) url.searchParams.delete(p);
    return url.toString();
  } catch {
    return env.DATABASE_URL;
  }
}

export function getPool(): pg.Pool {
  const h = holder.__pdaDb!;
  if (!h.pool) {
    h.pool = new pg.Pool({
      connectionString: connectionString(),
      ssl: sslOption(),
      max: getEnv().DATABASE_POOL_MAX,
      idleTimeoutMillis: 30_000,
      // Banco fora/lento não pode travar a página: falha rápido e cai nos fallbacks.
      connectionTimeoutMillis: 5_000,
    });
    // Erros de conexão ociosa não podem derrubar o processo.
    h.pool.on("error", () => undefined);
    const ssl = sslOption();
    const unverified = ssl === undefined ? urlSslMode(getEnv().DATABASE_URL) === "no-verify" : typeof ssl === "object" && ssl.rejectUnauthorized === false;
    if (unverified) {
      // Cifra, mas não confere quem é o servidor: prefira informar DATABASE_SSL_CA_BASE64.
      log.warn({ code: "db_tls_unverified" }, "db_tls_unverified");
    }
  }
  return h.pool;
}

export function getDb(): Db {
  const h = holder.__pdaDb!;
  if (!h.db) h.db = drizzle(getPool(), { schema });
  return h.db;
}

export async function closeDb(): Promise<void> {
  const h = holder.__pdaDb!;
  if (h.pool) await h.pool.end();
  h.pool = undefined;
  h.db = undefined;
}
