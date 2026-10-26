import "server-only";
import type { Conversation } from "@/server/db/schema";
import { getDecrypted } from "@/server/storage";
import { decodeText } from "./decode";
import { detectFileKind } from "./detect";
import { ingestImages } from "./images-ingest";
import { normalizeConversation, parseConversationText } from "./normalize";
import { looksLikeWhatsApp } from "./whatsapp";
import { naturalSort, readZipSafely } from "./zip";
import { IngestError } from "./types";
import type { IngestOutput, ProgressFn } from "./pipeline";

const TXT_RE = /\.txt$/i;
const IMG_RE = /\.(png|jpe?g|webp|heic|heif)$/i;

/** Prioridade para o .txt da exportação "com mídia" (plano.md 4.3). */
function txtPriority(name: string): number {
  const base = name.split("/").pop() ?? name;
  if (/^_chat\.txt$/i.test(base)) return 0;
  if (/whatsapp/i.test(base)) return 1;
  return 2;
}

export async function ingestZip(conv: Conversation, storageKey: string, onProgress: ProgressFn): Promise<IngestOutput> {
  await onProgress("unzipping");
  const buf = await getDecrypted(storageKey);
  const items = await readZipSafely(buf, (name) => TXT_RE.test(name) || IMG_RE.test(name));

  // 1) Exportação do WhatsApp: usa só o .txt e ignora as mídias.
  const txts = items.filter((i) => TXT_RE.test(i.name)).sort((a, b) => txtPriority(a.name) - txtPriority(b.name));
  for (const t of txts) {
    const text = decodeText(t.data);
    if (!looksLikeWhatsApp(text)) continue;
    await onProgress("organizing");
    return { normalized: normalizeConversation(parseConversationText(text, conv.timezone)), sourceType: "zip_whatsapp" };
  }

  // 2) Prints: confirma o tipo real (magic bytes) e ordena pelo nome (ordem natural).
  const images: { name: string; data: Buffer }[] = [];
  for (const item of naturalSort(items.filter((i) => IMG_RE.test(i.name)))) {
    const kind = await detectFileKind(item.data).catch(() => null);
    if (kind?.kind === "image") images.push(item);
  }
  if (images.length === 0) {
    // Um .txt que não é exportação do WhatsApp ainda pode estar no formato "Nome: mensagem".
    if (txts[0]) {
      return {
        normalized: normalizeConversation(parseConversationText(decodeText(txts[0].data), conv.timezone)),
        sourceType: "zip_whatsapp",
      };
    }
    throw new IngestError("zip_empty");
  }
  const out = await ingestImages(conv, images, onProgress);
  return { ...out, sourceType: "zip_images" };
}
