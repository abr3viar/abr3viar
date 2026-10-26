import "server-only";
import { eq, inArray } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { conversations, users, sessions, loginTokens } from "@/server/db/schema";
import { getStorage, uploadPrefix } from "@/server/storage";
import { log, safeErr } from "@/server/log";

/**
 * Exclusão REAL de uma análise: arquivos no storage + linhas em cascata
 * (mensagens, relatórios, seções, notas, consentimentos). Compras ficam, sem conteúdo
 * (report_id vira NULL), pelo prazo fiscal (D17).
 */
export async function deleteConversationData(conversationId: string): Promise<void> {
  try {
    await (await getStorage()).deletePrefix(uploadPrefix(conversationId));
  } catch (err) {
    // O job de limpeza tenta de novo; nunca bloquear a exclusão do banco.
    log.warn({ conversationId, err: safeErr(err) }, "delete_storage_failed");
  }
  await getDb().delete(conversations).where(eq(conversations.id, conversationId));
  log.info({ conversationId }, "conversation_deleted");
}

/** Exclui TODOS os dados de um usuário (direito do titular). */
export async function deleteUserData(userId: string): Promise<void> {
  const db = getDb();
  const convs = await db.select({ id: conversations.id }).from(conversations).where(eq(conversations.userId, userId));
  for (const c of convs) await deleteConversationData(c.id);
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (user) await db.delete(loginTokens).where(inArray(loginTokens.email, [user.email]));
  await db.delete(sessions).where(eq(sessions.userId, userId));
  await db.delete(users).where(eq(users.id, userId));
  log.info({ userId }, "user_deleted");
}
