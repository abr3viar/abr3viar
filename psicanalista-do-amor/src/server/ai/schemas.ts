import "server-only";
import { z } from "zod";

/**
 * Schemas zod TOLERANTES para a saída da IA (D12): campos ausentes/nulos viram
 * valores padrão; a validação semântica (seções esperadas, citações válidas) é feita
 * depois, no código que usa a resposta.
 */

const str = z.preprocess((v) => (typeof v === "number" ? String(v) : v), z.string()).catch("");
const nullableStr = z.preprocess(
  (v) => (typeof v === "number" ? String(v) : v === "" ? null : v),
  z.string().nullable(),
).catch(null);
/** Booleano tolerante: true/1/"true"/"sim"/"yes"/"1" (qualquer caixa) → true; resto → false. */
const bool = z
  .preprocess((v) => {
    if (typeof v === "boolean") return v;
    if (typeof v === "number") return v === 1;
    if (typeof v === "string") return /^(true|1|sim|yes|verdadeiro)$/i.test(v.trim());
    return false;
  }, z.boolean())
  .catch(false);
const int = z.coerce.number().int().catch(-1);
/** `seq` tolerante: 812, "812" ou "#812" (como aparece no prompt) → 812. */
const seqInt = z
  .preprocess((v) => (typeof v === "string" ? v.trim().replace(/^#\s*/, "") : v), z.coerce.number().int())
  .catch(-1);

/**
 * `key` normalizada: minúsculas, sem acento, "_" e espaços viram "-"
 * ("Pontos_de atrito" → "pontos-de-atrito").
 */
export function normalizeKey(v: string): string {
  return v
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/** `content` tolerante: lista de parágrafos (strings ou {text}) vira texto. */
function contentToText(v: unknown): unknown {
  if (!Array.isArray(v)) return v;
  return v
    .map((p) => {
      if (typeof p === "string") return p;
      if (typeof p === "number") return String(p);
      if (p && typeof p === "object") {
        const o = p as Record<string, unknown>;
        const t = o.text ?? o.content ?? o.paragraph;
        return typeof t === "string" ? t : "";
      }
      return "";
    })
    .filter((p) => p.trim() !== "")
    .join("\n\n");
}

export const evidenceSchema = z
  .array(
    z
      .object({ seq: seqInt, quote: str })
      .nullable()
      .catch(null),
  )
  .catch([])
  .transform((items) => items.filter((i): i is { seq: number; quote: string } => i !== null && i.seq > 0 && i.quote.trim() !== ""));

export const aiSectionSchema = z.object({
  key: str.transform(normalizeKey),
  title: str,
  locked_title: nullableStr.optional().transform((v) => v ?? null),
  content: z.preprocess(contentToText, str),
  evidence: evidenceSchema.optional().transform((v) => v ?? []),
});
export type AiSection = z.infer<typeof aiSectionSchema>;

/**
 * `sections` como objeto ({"retrato": {...}} ou {"retrato": "texto"}) vira lista,
 * com a chave do objeto como `key` quando a seção não trouxer uma.
 */
function sectionsToArray(v: unknown): unknown {
  if (Array.isArray(v) || !v || typeof v !== "object") return v;
  return Object.entries(v as Record<string, unknown>).map(([k, item]) => {
    if (typeof item === "string" || Array.isArray(item)) return { key: k, content: item };
    if (item && typeof item === "object") {
      const o = item as Record<string, unknown>;
      return typeof o.key === "string" && o.key.trim() ? o : { ...o, key: k };
    }
    return null;
  });
}

const sectionsArray = z
  .preprocess(sectionsToArray, z.array(aiSectionSchema.nullable().catch(null)))
  .catch([])
  .transform((items) => items.filter((s): s is AiSection => s !== null));

export const mainReportSchema = z.object({
  sections: sectionsArray,
  hook: nullableStr.optional().transform((v) => v ?? null),
  safety_flag: bool.optional().transform((v) => v ?? false),
});
export type MainReportOutput = z.infer<typeof mainReportSchema>;

export const singleSectionSchema = z.object({ section: aiSectionSchema.nullable().catch(null) });
export const hookSchema = z.object({ hook: nullableStr });

export const verdictSchema = z
  .object({
    label: str,
    score: z.coerce.number().min(0).max(100).nullable().catch(null),
    explanation: str,
  })
  .nullable()
  .catch(null);

export const extraReportSchema = z.object({
  sections: sectionsArray,
  verdict: verdictSchema.optional().transform((v) => v ?? null),
  safety_flag: bool.optional().transform((v) => v ?? false),
});
export type ExtraReportOutput = z.infer<typeof extraReportSchema>;

const strList = z
  .array(z.preprocess((v) => (typeof v === "string" ? v : null), z.string().nullable()).catch(null))
  .catch([])
  .transform((xs) => xs.filter((x): x is string => typeof x === "string" && x.trim() !== ""));

export const chunkNotesSchema = z.object({
  period: str,
  themes: strList,
  moments: z
    .array(z.object({ seq: seqInt, quote: str, why: str }).nullable().catch(null))
    .catch([])
    .transform((xs) => xs.filter((x): x is { seq: number; quote: string; why: string } => x !== null)),
  a_behaviors: strList,
  b_behaviors: strList,
  conflicts: strList,
  affection: strList,
  tone_shifts: strList,
  safety_concerns: strList,
});
export type ChunkNotes = z.infer<typeof chunkNotesSchema>;

export const visionOutputSchema = z.object({
  images: z
    .array(
      z
        .object({
          index: int,
          app: nullableStr,
          chat_title: nullableStr,
          messages: z
            .array(
              z
                .object({
                  side: z.enum(["left", "right", "center"]).catch("left"),
                  sender_name: nullableStr,
                  time: nullableStr,
                  day_label: nullableStr,
                  kind: z
                    .enum(["text", "media", "sticker", "audio", "deleted", "system"])
                    .catch("text"),
                  text: str,
                  quoted_text: nullableStr,
                  legible: z.preprocess((v) => (v === undefined || v === null ? true : v), z.boolean()).catch(true),
                })
                .nullable()
                .catch(null),
            )
            .catch([])
            .transform((xs) => xs.filter((x) => x !== null)),
        })
        .nullable()
        .catch(null),
    )
    .catch([])
    .transform((xs) => xs.filter((x) => x !== null)),
});
export type VisionOutput = z.infer<typeof visionOutputSchema>;
