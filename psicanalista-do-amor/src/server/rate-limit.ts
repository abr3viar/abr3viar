import "server-only";
import { and, eq, gt, sql } from "drizzle-orm";
import { isIP } from "node:net";
import { getDb } from "@/server/db/client";
import { rateLimits } from "@/server/db/schema";
import { pepperedHash } from "@/server/crypto";

export type RateAction = (typeof rateLimits.$inferInsert)["action"];

/**
 * `limit` vale para chaves de usuário/e-mail; `ipLimit` para chaves `ip:` — maior, porque
 * muitas pessoas dividem o mesmo IP (CGNAT de operadoras móveis, Wi-Fi público).
 */
export const LIMITS: Record<RateAction, { limit: number; ipLimit: number; netLimit: number; windowSec: number }> = {
  upload: { limit: 5, ipLimit: 20, netLimit: 12, windowSec: 3600 },
  login_email: { limit: 3, ipLimit: 30, netLimit: 60, windowSec: 900 },
  checkout: { limit: 10, ipLimit: 40, netLimit: 80, windowSec: 3600 },
  reprocess: { limit: 5, ipLimit: 20, netLimit: 40, windowSec: 3600 },
  export: { limit: 5, ipLimit: 20, netLimit: 40, windowSec: 3600 },
};

/** Rede do IP para o limite por faixa (`net:`): IPv4 /24, IPv6 /48. */
export function subnetForLimit(ip: string): string {
  const n = normalizeIpForLimit(ip);
  const v4 = /^(\d+)\.(\d+)\.(\d+)\.\d+$/.exec(n);
  if (v4) return `${v4[1]}.${v4[2]}.${v4[3]}.0/24`;
  if (n.endsWith("::/64")) return `${n.split(":").slice(0, 3).join(":")}::/48`;
  return n;
}

/**
 * Teto global de envios por hora (todas as pessoas): segura abuso que troca de IP e de
 * e-mail e esgotaria a cota da Groq para todo mundo.
 */
export async function consumeGlobalSlot(
  action: RateAction,
  maxPerHour: number,
  /** Janela e escopo opcionais (ex.: orçamento diário do SMTP, S-02). As linhas ficam 24 h. */
  opts: { windowSec?: number; scope?: string } = {},
): Promise<boolean> {
  const since = new Date(Date.now() - (opts.windowSec ?? 3600) * 1000);
  const keyHash = pepperedHash(`${action}:${opts.scope ?? "global"}`);
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${keyHash}))`);
    const [row] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(rateLimits)
      .where(and(eq(rateLimits.action, action), eq(rateLimits.keyHash, keyHash), gt(rateLimits.createdAt, since)));
    if ((row?.n ?? 0) >= maxPerHour) return false;
    await tx.insert(rateLimits).values({ keyHash, action });
    return true;
  });
}

export const consumeGlobalUploadSlot = (maxPerHour: number) => consumeGlobalSlot("upload", maxPerHour);

/** Só confere (sem registrar) se alguma chave já estourou o limite. */
export async function isRateLimited(action: RateAction, keys: string[]): Promise<boolean> {
  const { limit, windowSec } = LIMITS[action];
  const since = new Date(Date.now() - windowSec * 1000);
  for (const k of keys.filter(Boolean)) {
    const [row] = await getDb()
      .select({ n: sql<number>`count(*)::int` })
      .from(rateLimits)
      .where(and(eq(rateLimits.action, action), eq(rateLimits.keyHash, pepperedHash(`${action}:${k}`)), gt(rateLimits.createdAt, since)));
    if ((row?.n ?? 0) >= limit) return true;
  }
  return false;
}

/** IPv6 vira o prefixo /64 (um cliente costuma controlar o bloco inteiro); IPv4 fica igual. */
export function normalizeIpForLimit(ip: string): string {
  const raw = ip.trim().replace(/^\[|\]$/g, "");
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(raw);
  if (mapped) return mapped[1]!;
  if (isIP(raw) !== 6) return raw;
  const [head, tail = ""] = raw.toLowerCase().split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const full = raw.includes("::") ? [...left, ...Array(8 - left.length - right.length).fill("0"), ...right] : left;
  return `${full.slice(0, 4).map((g) => g.padStart(4, "0")).join(":")}::/64`;
}

/**
 * Rate limit no Postgres (plano.md 10.4). Cada chave (IP, e-mail, usuário) é guardada
 * só como hash com pepper. Retorna false se QUALQUER chave estourou o limite.
 * Contar e registrar acontece numa transação com advisory lock por chave: requisições
 * paralelas não furam o limite.
 */
export async function consumeRateLimit(action: RateAction, keys: string[]): Promise<boolean> {
  const { limit, ipLimit, netLimit, windowSec } = LIMITS[action];
  const since = new Date(Date.now() - windowSec * 1000);
  const entries = [
    ...new Map(
      keys
        .filter(Boolean)
        .map((k) => (k.startsWith("ip:") ? `ip:${normalizeIpForLimit(k.slice(3))}` : k.startsWith("net:") ? `net:${subnetForLimit(k.slice(4))}` : k))
        .map((k) => [pepperedHash(`${action}:${k}`), k.startsWith("ip:") ? ipLimit : k.startsWith("net:") ? netLimit : limit] as const),
    ).entries(),
  ].sort(([a], [b]) => (a < b ? -1 : 1)); // ordem fixa evita deadlock entre locks
  if (entries.length === 0) return true;
  return getDb().transaction(async (tx) => {
    for (const [keyHash] of entries) await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${keyHash}))`);
    for (const [keyHash, max] of entries) {
      const [row] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(rateLimits)
        .where(and(eq(rateLimits.action, action), eq(rateLimits.keyHash, keyHash), gt(rateLimits.createdAt, since)));
      if ((row?.n ?? 0) >= max) return false;
    }
    await tx.insert(rateLimits).values(entries.map(([keyHash]) => ({ keyHash, action })));
    return true;
  });
}
