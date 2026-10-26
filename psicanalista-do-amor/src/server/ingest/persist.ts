import "server-only";
import { eq } from "drizzle-orm";
import { encryptField, encryptJson } from "@/server/crypto";
import { getDb } from "@/server/db/client";
import { conversationFiles, conversations, messages } from "@/server/db/schema";
import { getStorage, uploadPrefix } from "@/server/storage";
import type { NormalizedConversation } from "./normalize";

const BATCH = 500;

/** Grava as mensagens normalizadas CIFRADAS e deixa a conversa pronta para confirmação. */
export async function saveNormalized(
  conversationId: string,
  normalized: NormalizedConversation,
  extra: { sourceType?: "zip_whatsapp" | "zip_images" } = {},
): Promise<void> {
  const db = getDb();
  const timed = normalized.messages.filter((m) => m.sentAt).map((m) => m.sentAt!.getTime());
  await db.transaction(async (tx) => {
    await tx.delete(messages).where(eq(messages.conversationId, conversationId));
    for (let i = 0; i < normalized.messages.length; i += BATCH) {
      const batch = normalized.messages.slice(i, i + BATCH);
      await tx.insert(messages).values(
        batch.map((m) => ({
          conversationId,
          seq: m.seq,
          sender: m.sender,
          senderIndex: m.senderIndex,
          senderRaw: m.senderRaw ? encryptField(m.senderRaw) : null,
          sentAt: m.sentAt,
          kind: m.kind,
          content: encryptField(m.content),
          source: m.source,
          ocrConfidence: m.ocrConfidence ?? null,
        })),
      );
    }
    await tx
      .update(conversations)
      .set({
        status: "needs_confirmation",
        progress: { step: "ready_to_confirm" },
        errorCode: null,
        detectedSenders: encryptJson(normalized.senders),
        warnings: normalized.warnings,
        messageCount: normalized.messages.length,
        hasTimestamps: normalized.hasTimestamps,
        startedAt: timed.length ? new Date(Math.min(...timed)) : null,
        endedAt: timed.length ? new Date(Math.max(...timed)) : null,
        ...(extra.sourceType ? { sourceType: extra.sourceType } : {}),
      })
      .where(eq(conversations.id, conversationId));
  });
}

/** Apaga os arquivos originais (regra crítica 9) e registra quando. */
export async function purgeOriginalFiles(conversationId: string): Promise<void> {
  const storage = await getStorage();
  await storage.deletePrefix(uploadPrefix(conversationId));
  const now = new Date();
  const db = getDb();
  await db
    .update(conversationFiles)
    .set({ purgedAt: now })
    .where(eq(conversationFiles.conversationId, conversationId));
  await db.update(conversations).set({ filesPurgedAt: now }).where(eq(conversations.id, conversationId));
}
