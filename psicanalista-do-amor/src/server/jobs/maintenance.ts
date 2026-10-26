import "server-only";
import { and, inArray, isNull, lt } from "drizzle-orm";
import { getEnv } from "@/env";
import { getDb } from "@/server/db/client";
import { conversationFiles, conversations, loginTokens, rateLimits, sessions } from "@/server/db/schema";
import { purgeOriginalFiles } from "@/server/ingest/persist";
import { log, safeErr } from "@/server/log";
import { getStorage } from "@/server/storage";
import type { JobHandler } from "./register";

export const ORIGINALS_MAX_AGE_MS = 24 * 3_600_000;

/**
 * Limpeza horária (plano.md 10.1): originais com mais de 24 h (mesmo com falha),
 * objetos órfãos no storage, rate limits, sessões e tokens vencidos.
 */
export async function cleanupFiles(now = new Date()): Promise<{ purged: number; orphans: number }> {
  const db = getDb();
  const cutoff = new Date(now.getTime() - ORIGINALS_MAX_AGE_MS);

  const stale = await db
    .selectDistinct({ id: conversationFiles.conversationId })
    .from(conversationFiles)
    .where(and(isNull(conversationFiles.purgedAt), lt(conversationFiles.createdAt, cutoff)));
  for (const { id } of stale) {
    await purgeOriginalFiles(id).catch((err: unknown) => log.warn({ conversationId: id, err: safeErr(err) }, "purge_failed"));
  }

  // Órfãos: objetos de conversas que não existem mais (ou upload que falhou antes do banco).
  const storage = await getStorage();
  const objects = await storage.list("uploads/");
  const byConv = new Map<string, Date>();
  for (const o of objects) {
    const convId = o.key.split("/")[1];
    if (!convId) continue;
    const prev = byConv.get(convId);
    if (!prev || o.lastModified > prev) byConv.set(convId, o.lastModified);
  }
  const ids = [...byConv.keys()].filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  const existing = new Set(
    ids.length
      ? (await db.select({ id: conversations.id }).from(conversations).where(inArray(conversations.id, ids))).map((r) => r.id)
      : [],
  );
  let orphans = 0;
  for (const [convId, lastModified] of byConv) {
    const old = lastModified < new Date(now.getTime() - 3_600_000);
    if ((!existing.has(convId) && old) || lastModified < cutoff) {
      await storage.deletePrefix(`uploads/${convId}/`);
      orphans++;
    }
  }

  await db.delete(rateLimits).where(lt(rateLimits.createdAt, new Date(now.getTime() - 86_400_000)));
  // Marco Civil, art. 15: registros de acesso guardados por 6 meses, depois apagados.
  const { purgeOldAccessLogs } = await import("@/server/access-log");
  await purgeOldAccessLogs(now);
  await db.delete(sessions).where(lt(sessions.expiresAt, now));
  await db.delete(loginTokens).where(lt(loginTokens.expiresAt, new Date(now.getTime() - 86_400_000)));
  // Conversas presas em "uploaded/processing" há mais de 24 h viram falha.
  await db
    .update(conversations)
    .set({ status: "failed", errorCode: "ingest_failed", progress: { step: "failed" } })
    .where(and(inArray(conversations.status, ["uploaded", "processing"]), lt(conversations.updatedAt, cutoff)));
  log.info({ purged: stale.length, orphans }, "cleanup_files_done");
  return { purged: stale.length, orphans };
}

export const handleCleanupFiles: JobHandler<"cleanup_files"> = async () => {
  await cleanupFiles();
};

export const handleRetention: JobHandler<"retention"> = async () => {
  const { runRetention } = await import("@/server/maintenance/retention");
  await runRetention();
};

export const handleReconcilePayments: JobHandler<"reconcile_payments"> = async () => {
  // Em dev/testes com chave falsa não há o que consultar no Stripe.
  if (getEnv().NODE_ENV !== "production" && /fake|dummy|e2e/i.test(getEnv().STRIPE_SECRET_KEY)) return;
  const { reconcilePayments } = await import("@/server/maintenance/reconcile");
  await reconcilePayments();
  // Assinaturas (D96): reconfere no Stripe as abertas (renovação/cancelamento perdidos).
  const { syncOpenSubscriptions } = await import("@/server/payments/subscriptions");
  await syncOpenSubscriptions();
};

export const handleRotateEncryptionKey: JobHandler<"rotate_encryption_key"> = async () => {
  const { rotateEncryptionKey } = await import("@/server/maintenance/rotate-key");
  await rotateEncryptionKey();
};

