import "server-only";
import { and, eq, lt, sql } from "drizzle-orm";
import { getEnv } from "@/env";
import { getDb } from "@/server/db/client";
import { conversations, reports } from "@/server/db/schema";

/** Data de exclusão automática: 7 dias (não pago) ou 180 dias (pago) sem acesso (D17). */
export function computeExpiresAt(isPaid: boolean, from: Date = new Date()): Date {
  const env = getEnv();
  const days = isPaid ? env.RETENTION_PAID_DAYS : env.RETENTION_UNPAID_DAYS;
  return new Date(from.getTime() + days * 86_400_000);
}

export async function conversationHasPaidReport(conversationId: string): Promise<boolean> {
  const [row] = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(reports)
    .where(and(eq(reports.conversationId, conversationId), eq(reports.isUnlocked, true)));
  return (row?.n ?? 0) > 0;
}

/** Registra acesso (no máximo 1 vez por hora) e empurra a data de exclusão. */
export async function touchConversation(conversationId: string): Promise<void> {
  const db = getDb();
  const paid = await conversationHasPaidReport(conversationId);
  const now = new Date();
  await db
    .update(conversations)
    .set({ lastAccessedAt: now, expiresAt: computeExpiresAt(paid, now), retentionWarnedAt: null })
    .where(and(eq(conversations.id, conversationId), lt(conversations.lastAccessedAt, new Date(now.getTime() - 3_600_000))));
}
