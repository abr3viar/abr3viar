import "server-only";
import { eq } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { conversations } from "@/server/db/schema";
import { purgeOriginalFiles, saveNormalized } from "@/server/ingest/persist";
import { runIngest } from "@/server/ingest/pipeline";
import { IngestError } from "@/server/ingest/types";
import { log, safeErr, SafeError } from "@/server/log";
import type { JobHandler } from "./register";

export const handleIngest: JobHandler<"ingest"> = async (job, { isFinalAttempt }) => {
  const { conversationId } = job.data;
  const db = getDb();
  const [conv] = await db.select().from(conversations).where(eq(conversations.id, conversationId));
  if (!conv || conv.status === "deleted") return;
  if (!["uploaded", "processing", "failed"].includes(conv.status)) return; // já processada

  const setProgress = async (step: string, current?: number, total?: number) => {
    await db
      .update(conversations)
      .set({ status: "processing", progress: { step, current, total } })
      .where(eq(conversations.id, conversationId));
  };

  try {
    await setProgress("reading");
    const { normalized, sourceType } = await runIngest(conv, setProgress);
    await saveNormalized(conversationId, normalized, { sourceType });
    await purgeOriginalFiles(conversationId);
    log.info(
      { conversationId, messages: normalized.messages.length, senders: normalized.senders.length, format: normalized.format },
      "ingest_done",
    );
  } catch (err) {
    const permanent = err instanceof IngestError;
    const code = err instanceof IngestError || err instanceof SafeError ? err.code : "ingest_failed";
    log.warn({ conversationId, code, err: safeErr(err) }, "ingest_error");
    if (permanent || isFinalAttempt) {
      await db
        .update(conversations)
        .set({ status: "failed", errorCode: code, progress: { step: "failed" } })
        .where(eq(conversations.id, conversationId));
      // Formato inválido: os originais não servem mais; apagar já.
      if (permanent) await purgeOriginalFiles(conversationId).catch(() => undefined);
      return;
    }
    throw err;
  }
};
