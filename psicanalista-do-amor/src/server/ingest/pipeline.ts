import "server-only";
import { asc, eq, isNull, and } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { conversationFiles, type Conversation } from "@/server/db/schema";
import { getDecrypted } from "@/server/storage";
import { normalizeConversation, parseConversationText, parseTextBuffer, type NormalizedConversation } from "./normalize";
import { decodeText } from "./decode";
import { IngestError } from "./types";

export type ProgressFn = (step: string, current?: number, total?: number) => Promise<void>;

export type IngestOutput = {
  normalized: NormalizedConversation;
  sourceType?: "zip_whatsapp" | "zip_images";
};

async function loadFiles(conversationId: string) {
  const rows = await getDb()
    .select()
    .from(conversationFiles)
    .where(and(eq(conversationFiles.conversationId, conversationId), isNull(conversationFiles.purgedAt)))
    .orderBy(asc(conversationFiles.orderIndex));
  if (rows.length === 0) throw new IngestError("files_missing");
  return rows;
}

/** Lê os originais e devolve a conversa normalizada (sem gravar). */
export async function runIngest(conv: Conversation, onProgress: ProgressFn): Promise<IngestOutput> {
  const files = await loadFiles(conv.id);
  switch (conv.sourceType) {
    case "paste": {
      await onProgress("organizing");
      const text = decodeText(await getDecrypted(files[0]!.storageKey));
      return { normalized: normalizeConversation(parseConversationText(text, conv.timezone)) };
    }
    case "txt": {
      await onProgress("organizing");
      return { normalized: normalizeConversation(parseTextBuffer(await getDecrypted(files[0]!.storageKey), conv.timezone)) };
    }
    case "zip_images":
    case "zip_whatsapp": {
      const { ingestZip } = await import("./zip-ingest");
      return ingestZip(conv, files[0]!.storageKey, onProgress);
    }
    case "images": {
      const { ingestImages } = await import("./images-ingest");
      return ingestImages(
        conv,
        await Promise.all(files.map(async (f) => ({ data: await getDecrypted(f.storageKey) }))),
        onProgress,
      );
    }
  }
}
