import "server-only";
import type { ConversationStatusView } from "@/lib/views";
import { and, eq, inArray, ne } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { conversations, sessions, type Conversation } from "@/server/db/schema";
import type { Viewer } from "@/server/auth/session";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/**
 * Regra de autorização (CLAUDE.md, regra 7, e D26): a conversa precisa ser do usuário
 * e, se a sessão não foi verificada pelo link mágico, ter sido criada por esta sessão.
 */
export function canAccess(viewer: Viewer, conv: Pick<Conversation, "userId" | "createdBySessionId">): boolean {
  if (conv.userId !== viewer.userId) return false;
  return viewer.verified || conv.createdBySessionId === viewer.sessionId;
}

/** Conversa do usuário, ou null (a página responde 404 — nunca 403). */
export async function getOwnedConversation(id: string, viewer: Viewer | null): Promise<Conversation | null> {
  if (!viewer || !isUuid(id)) return null;
  const [conv] = await getDb()
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, id), eq(conversations.userId, viewer.userId), ne(conversations.status, "deleted")));
  if (!conv || !canAccess(viewer, conv)) return null;
  return conv;
}

/**
 * Análises que entraram na conta por uma sessão LEVE de outro aparelho/navegador (S-03): alguém
 * digitou este e-mail num envio sem login. Só faz sentido para quem entrou pelo link do e-mail.
 */
export async function sentWithoutLogin(
  viewer: Viewer,
  convs: Pick<Conversation, "id" | "createdBySessionId">[],
): Promise<Set<string>> {
  if (!viewer.verified) return new Set();
  const bySession = convs.filter((c) => c.createdBySessionId && c.createdBySessionId !== viewer.sessionId);
  if (bySession.length === 0) return new Set();
  const light = await getDb()
    .select({ id: sessions.id })
    .from(sessions)
    .where(and(inArray(sessions.id, bySession.map((c) => c.createdBySessionId!)), eq(sessions.verified, false)));
  const lightIds = new Set(light.map((s) => s.id));
  return new Set(bySession.filter((c) => lightIds.has(c.createdBySessionId!)).map((c) => c.id));
}

/**
 * Ao comprar com a sessão verificada, a sessão leve que enviou a análise (de outro aparelho)
 * perde o acesso a ela (S-03): quem digitou o e-mail de outra pessoa não lê o que ela pagou.
 */
export async function cutLightSessionAccess(viewer: Viewer, conv: Pick<Conversation, "id" | "createdBySessionId">): Promise<void> {
  if (!(await sentWithoutLogin(viewer, [conv])).has(conv.id)) return;
  await getDb().update(conversations).set({ createdBySessionId: null }).where(eq(conversations.id, conv.id));
}

/** Status para a tela de progresso (sem conteúdo). */
export function conversationStatusView(conv: Conversation): ConversationStatusView {
  const canRetry = Boolean(conv.participantAName && conv.messageCount > 0) || conv.filesPurgedAt === null;
  return { status: conv.status, progress: conv.progress ?? null, errorCode: conv.errorCode, canRetry };
}
