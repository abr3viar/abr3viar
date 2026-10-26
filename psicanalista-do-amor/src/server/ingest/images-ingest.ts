import "server-only";
import { getEnv } from "@/env";
import { getAiClient, rejectOutput } from "@/server/ai/client";
import { visionSystemPrompt } from "@/server/ai/prompts/vision-extract";
import { visionOutputSchema } from "@/server/ai/schemas";
import type { Conversation } from "@/server/db/schema";
import { log } from "@/server/log";
import { dedupeImages, prepareImage, type PreparedImage } from "./images";
import { normalizeConversation } from "./normalize";
import { assignTimestamps } from "./ocr-dates";
import { stitchImages, type OcrMessage } from "./stitch";
import { IngestError, type MessageKind, type NormalizedMessage } from "./types";
import type { IngestOutput, ProgressFn } from "./pipeline";

export const RIGHT_LABEL = "Pessoa da direita";
export const LEFT_LABEL = "Pessoa da esquerda";

const KIND: Record<OcrMessage["kind"], MessageKind> = {
  text: "text",
  media: "media_omitted",
  sticker: "sticker",
  audio: "audio",
  deleted: "deleted",
  system: "system",
};

/** Lê as prints com o modelo de visão, em lotes, na ordem (plano.md 4.5). */
export async function ocrImages(
  images: PreparedImage[],
  onProgress: ProgressFn,
): Promise<{ perImage: OcrMessage[][]; chatTitles: (string | null)[] }> {
  const env = getEnv();
  const batchSize = Math.max(1, env.GROQ_VISION_MAX_IMAGES_PER_REQUEST);
  const ai = getAiClient();
  const perImage: OcrMessage[][] = [];
  const chatTitles: (string | null)[] = [];
  for (let start = 0; start < images.length; start += batchSize) {
    const batch = images.slice(start, start + batchSize);
    await onProgress("ocr", start, images.length);
    const res = await ai.callJson({
      purpose: "vision",
      label: "ocr_batch",
      schema: visionOutputSchema,
      maxCompletionTokens: 4000,
      temperature: 0,
      messages: [
        { role: "system", content: visionSystemPrompt() },
        {
          role: "user",
          content: [
            { type: "text", text: `Transcreva estas ${batch.length} captura(s) de tela, em ordem (index 0 a ${batch.length - 1}).` },
            ...batch.map((img) => ({
              type: "image_url" as const,
              image_url: { url: `data:image/jpeg;base64,${img.data.toString("base64")}` },
            })),
          ],
        },
      ],
      validate: (d) => {
        if (d.images.length === 0) rejectOutput("no_images");
      },
    });
    const byIndex = new Map(res.data.images.map((img, i) => [img.index >= 0 && img.index < batch.length ? img.index : i, img]));
    for (let i = 0; i < batch.length; i++) {
      const img = byIndex.get(i);
      chatTitles.push(img?.chat_title ?? null);
      perImage.push(
        (img?.messages ?? []).map((m) => ({
          imageIndex: start + i,
          side: m.side,
          senderName: m.sender_name,
          time: m.time,
          dayLabel: m.day_label,
          kind: m.kind,
          text: m.text,
          legible: m.legible && !m.text.includes("[ilegível]"),
        })),
      );
    }
    await onProgress("ocr", Math.min(start + batch.length, images.length), images.length);
  }
  return { perImage, chatTitles };
}

/** Converte as mensagens costuradas em NormalizedMessage com remetentes e datas. */
export function ocrToNormalized(
  messages: OcrMessage[],
  opts: { chatTitle: string | null; reference: Date; timeZone: string },
): { messages: NormalizedMessage[]; sides: Map<string, "left" | "right">; hasTimestamps: boolean } {
  const isGroup = messages.some((m) => m.side === "left" && m.senderName);
  const sides = new Map<string, "left" | "right">();
  const times = assignTimestamps(messages, opts.reference, opts.timeZone);
  let lastLeftName: string | null = null;
  const out: NormalizedMessage[] = messages.map((m, i) => {
    const kind = m.side === "center" ? "system" : KIND[m.kind];
    let senderRaw = "";
    if (kind !== "system") {
      if (m.side === "right") senderRaw = RIGHT_LABEL;
      else if (isGroup) {
        lastLeftName = m.senderName?.trim() || lastLeftName;
        senderRaw = lastLeftName ?? LEFT_LABEL;
      } else senderRaw = opts.chatTitle?.trim() || LEFT_LABEL;
      sides.set(senderRaw, m.side === "right" ? "right" : "left");
    }
    return {
      seq: i + 1,
      senderRaw,
      sentAt: times[i] ?? null,
      kind,
      content: kind === "text" || kind === "system" ? m.text : "",
      source: "ocr",
      ocrConfidence: m.legible ? 0.95 : 0.3,
    };
  });
  const timed = out.filter((m) => m.sentAt).length;
  return { messages: out, sides, hasTimestamps: timed / Math.max(1, out.length) >= 0.6 };
}

function mostCommon(values: (string | null)[]): string | null {
  const counts = new Map<string, number>();
  for (const v of values) if (v?.trim()) counts.set(v.trim(), (counts.get(v.trim()) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

export async function ingestImages(
  conv: Conversation,
  files: { data: Buffer }[],
  onProgress: ProgressFn,
): Promise<IngestOutput> {
  const env = getEnv();
  if (files.length === 0) throw new IngestError("no_files");
  if (files.length > env.MAX_IMAGES) throw new IngestError("too_many_images");
  const prepared: PreparedImage[] = [];
  for (const [i, f] of files.entries()) {
    await onProgress("preparing_images", i + 1, files.length);
    if (f.data.length > env.MAX_IMAGE_BYTES) throw new IngestError("image_too_large");
    prepared.push(await prepareImage(f.data));
  }
  const { kept, removed } = dedupeImages(prepared);

  const { perImage, chatTitles } = await ocrImages(kept, onProgress);
  const stitched = stitchImages(perImage);
  if (stitched.messages.filter((m) => m.side !== "center").length === 0) throw new IngestError("ocr_empty");

  // O título do chat (cabeçalho) só vale para conversas 1:1.
  const chatTitle = mostCommon(chatTitles);
  const { messages, sides, hasTimestamps } = ocrToNormalized(stitched.messages, {
    chatTitle,
    reference: conv.createdAt,
    timeZone: conv.timezone,
  });
  await onProgress("organizing");
  const normalized = normalizeConversation({ messages, format: "ocr", hasTimestamps }, { sides });
  if (removed > 0) normalized.warnings.duplicate_images = removed;
  const illegible = messages.filter((m) => (m.ocrConfidence ?? 1) < 0.6).length;
  if (illegible > 0) normalized.warnings.ocr_low_confidence = illegible;
  log.info({ conversationId: conv.id, images: files.length, kept: kept.length, overlap: stitched.removed }, "ocr_done");
  return { normalized };
}
