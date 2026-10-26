import "server-only";
import { and, eq, gt, inArray, isNull, lt, ne, sql } from "drizzle-orm";
import { getEnv } from "@/env";
import { getDb } from "@/server/db/client";
import { auditLog, conversations, loginTokens, reports, sessions, subscriptions, users } from "@/server/db/schema";
import { deleteConversationData } from "@/server/data-deletion";
import { enqueue } from "@/server/jobs/boss";
import { log } from "@/server/log";

const WARN_DAYS = 7;

/**
 * Retenção diária (plano.md 10.1, D17): apaga análises cuja data de exclusão passou
 * (7 dias sem acesso se não pagas, 180 se pagas) e avisa por e-mail 7 dias antes
 * nas pagas. Compras ficam, sem conteúdo.
 */
export async function runRetention(now = new Date()): Promise<{ deleted: number; warned: number; usersPurged: number }> {
  const db = getDb();
  const expired = await db
    .select({ id: conversations.id, userId: conversations.userId })
    .from(conversations)
    .where(lt(conversations.expiresAt, now))
    .limit(500);
  for (const c of expired) {
    await deleteConversationData(c.id);
    await db.insert(auditLog).values({ userId: c.userId, action: "data.retention_deleted", targetId: c.id });
  }

  const soon = new Date(now.getTime() + WARN_DAYS * 86_400_000);
  const candidates = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(
      and(
        lt(conversations.expiresAt, soon),
        gt(conversations.expiresAt, now),
        isNull(conversations.retentionWarnedAt),
        ne(conversations.status, "deleted"),
      ),
    )
    .limit(500);
  let warned = 0;
  if (candidates.length) {
    const paid = new Set(
      (
        await db
          .select({ c: reports.conversationId })
          .from(reports)
          .where(and(eq(reports.isUnlocked, true), inArray(reports.conversationId, candidates.map((c) => c.id))))
      ).map((r) => r.c),
    );
    for (const c of candidates) {
      if (!paid.has(c.id)) continue;
      await db.transaction(async (tx) => {
        await tx.update(conversations).set({ retentionWarnedAt: now }).where(eq(conversations.id, c.id));
        await enqueue("send_email", { template: "retention_warning", conversationId: c.id }, { tx, singletonKey: `retention:${c.id}` });
      });
      warned++;
    }
  }
  const usersPurged = await purgeIdleUsers(now);
  log.info({ deleted: expired.length, warned, usersPurged }, "retention_done");
  return { deleted: expired.length, warned, usersPurged };
}

/**
 * Minimização (LGPD): e-mails de quem não tem mais nenhuma análise nem sessão válida são
 * apagados depois de RETENTION_UNPAID_DAYS (inclui e-mails digitados por engano ou de
 * terceiros). Compras ficam, com user_id nulo (prazo fiscal, D64).
 */
async function purgeIdleUsers(now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - getEnv().RETENTION_UNPAID_DAYS * 86_400_000);
  const purged = await getDb()
    .delete(users)
    .where(
      and(
        lt(users.createdAt, cutoff),
        sql`NOT EXISTS (SELECT 1 FROM ${conversations} WHERE ${conversations.userId} = ${users.id})`,
        sql`NOT EXISTS (SELECT 1 FROM ${sessions} WHERE ${sessions.userId} = ${users.id} AND ${sessions.expiresAt} > ${now})`,
        // Assinante (D96) nunca é apagado por inatividade enquanto a assinatura estiver aberta.
        sql`NOT EXISTS (SELECT 1 FROM ${subscriptions} WHERE ${subscriptions.userId} = ${users.id} AND ${subscriptions.status} NOT IN ('canceled', 'incomplete_expired'))`,
      ),
    )
    .returning({ id: users.id, email: users.email });
  if (purged.length) await getDb().delete(loginTokens).where(inArray(loginTokens.email, purged.map((u) => u.email)));
  if (purged.length) await getDb().insert(auditLog).values({ action: "data.idle_users_purged", meta: { count: purged.length } });
  return purged.length;
}
