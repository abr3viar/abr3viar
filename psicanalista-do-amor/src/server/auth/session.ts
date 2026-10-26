import "server-only";
import { cache } from "react";
import { and, eq, gt, isNull } from "drizzle-orm";
import { cookies } from "next/headers";
import { getEnv, adminEmails } from "@/env";
import { getDb } from "@/server/db/client";
import { sessions, users } from "@/server/db/schema";
import { pepperedHash, randomToken, tokenHash } from "@/server/crypto";

/**
 * Sessões (plano.md 10.4, D4, D26): cookie `__Host-session` (HttpOnly, Secure,
 * SameSite=Lax, 30 dias); no banco só o hash do token.
 */

const SESSION_DAYS = 30;
/** Sessão leve (criada no envio, sem link mágico) dura menos: aparelho compartilhado. */
const LIGHT_SESSION_DAYS = 7;

export type Viewer = {
  sessionId: string;
  userId: string;
  email: string;
  /** true = entrou pelo link mágico; false = sessão leve criada no envio. */
  verified: boolean;
  isAdmin: boolean;
};

export function sessionCookieName(): string {
  return getEnv().APP_URL.startsWith("https://") ? "__Host-session" : "pda_session";
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function findOrCreateUser(email: string): Promise<{ id: string; email: string }> {
  const db = getDb();
  const normalized = normalizeEmail(email);
  const [existing] = await db.select().from(users).where(eq(users.email, normalized));
  if (existing) {
    if (existing.deletedAt) {
      await db.update(users).set({ deletedAt: null }).where(eq(users.id, existing.id));
    }
    return { id: existing.id, email: existing.email };
  }
  const [created] = await db
    .insert(users)
    .values({ email: normalized })
    .onConflictDoUpdate({ target: users.email, set: { updatedAt: new Date() } })
    .returning();
  return { id: created!.id, email: created!.email };
}

/** Cria a sessão e grava o cookie. Só pode ser chamada em Server Action ou Route Handler. */
export async function createSession(
  userId: string,
  opts: { verified: boolean; userAgent?: string },
): Promise<{ sessionId: string }> {
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + (opts.verified ? SESSION_DAYS : LIGHT_SESSION_DAYS) * 86_400_000);
  const [row] = await getDb()
    .insert(sessions)
    .values({
      userId,
      tokenHash: tokenHash(token),
      verified: opts.verified,
      expiresAt,
      userAgentHash: opts.userAgent ? pepperedHash(opts.userAgent) : null,
    })
    .returning({ id: sessions.id });
  const jar = await cookies();
  jar.set(sessionCookieName(), token, {
    httpOnly: true,
    secure: getEnv().APP_URL.startsWith("https://"),
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
  return { sessionId: row!.id };
}

async function loadViewer(): Promise<Viewer | null> {
  const jar = await cookies();
  const token = jar.get(sessionCookieName())?.value;
  if (!token || token.length > 200) return null;
  const [row] = await getDb()
    .select({
      sessionId: sessions.id,
      userId: users.id,
      email: users.email,
      verified: sessions.verified,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, tokenHash(token)), gt(sessions.expiresAt, new Date()), isNull(users.deletedAt)));
  if (!row) return null;
  return { ...row, isAdmin: row.verified && adminEmails().includes(row.email) };
}

/** Usuário da requisição atual (memoizado por requisição). */
export const getViewer = cache(loadViewer);

/** "Sair de todos os aparelhos": apaga todas as sessões do usuário (inclusive esta). */
export async function destroyAllSessions(userId: string): Promise<void> {
  await getDb().delete(sessions).where(eq(sessions.userId, userId));
  (await cookies()).delete(sessionCookieName());
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(sessionCookieName())?.value;
  if (token) await getDb().delete(sessions).where(eq(sessions.tokenHash, tokenHash(token)));
  jar.delete(sessionCookieName());
}
