import "server-only";
import { and, eq, gt, isNull } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { loginTokens, users } from "@/server/db/schema";
import { randomToken, tokenHash } from "@/server/crypto";
import { EmailBudgetError, sendEmail } from "@/server/email/send";
import { magicLinkEmail } from "@/server/email/templates";
import { consumeGlobalSlot, consumeRateLimit } from "@/server/rate-limit";
import { log, safeErr } from "@/server/log";
import { createSession, findOrCreateUser, normalizeEmail } from "./session";
import { recordAccess } from "@/server/access-log";

const TOKEN_MINUTES = 15;

/**
 * Pede um link mágico. A resposta para o usuário é sempre a mesma, exista ou não a
 * conta (sem enumeração). Rate limit: 3 pedidos / 15 min por e-mail e por IP.
 */
export async function requestMagicLink(email: string, ip: string): Promise<{ rateLimited: boolean }> {
  const normalized = normalizeEmail(email);
  const allowed =
    (await consumeRateLimit("login_email", [`email:${normalized}`, `ip:${ip}`, `net:${ip}`])) &&
    // Teto do site inteiro: ninguém usa o formulário para bombardear e-mails de terceiros.
    (await consumeGlobalSlot("login_email", 300));
  if (!allowed) return { rateLimited: true };
  const token = randomToken(32);
  await getDb()
    .insert(loginTokens)
    .values({ email: normalized, tokenHash: tokenHash(token), expiresAt: new Date(Date.now() + TOKEN_MINUTES * 60_000) });
  try {
    await sendEmail({ to: normalized, ...magicLinkEmail(token), template: "magic_link" });
  } catch (err) {
    // Orçamento diário do e-mail esgotado (S-02): a pessoa vê "tente mais tarde".
    if (err instanceof EmailBudgetError) return { rateLimited: true };
    log.warn({ err: safeErr(err) }, "magic_link_email_failed");
  }
  return { rateLimited: false };
}

/** Consome o token (uso único) e cria uma sessão verificada. */
export async function consumeMagicLink(token: string, userAgent: string): Promise<boolean> {
  if (!token || token.length > 200) return false;
  const db = getDb();
  const [row] = await db
    .update(loginTokens)
    .set({ usedAt: new Date() })
    .where(and(eq(loginTokens.tokenHash, tokenHash(token)), isNull(loginTokens.usedAt), gt(loginTokens.expiresAt, new Date())))
    .returning();
  if (!row) return false;
  const user = await findOrCreateUser(row.email);
  await db.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, user.id));
  await createSession(user.id, { verified: true, userAgent });
  await recordAccess("login", user.id);
  return true;
}
