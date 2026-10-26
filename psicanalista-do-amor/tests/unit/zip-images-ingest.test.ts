import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AiClient, setAiClientForTests, type ChatRequest, type ChatTransport } from "@/server/ai/client";
import { NoopRateLimiter } from "@/server/ai/rate-limiter";
import type { Conversation } from "@/server/db/schema";
import { ingestImages } from "@/server/ingest/images-ingest";
import { ingestZip } from "@/server/ingest/zip-ingest";
import { IngestError } from "@/server/ingest/types";
import { putEncrypted, setStorageForTests, getStorage } from "@/server/storage";
import { buildZip } from "../helpers/zip";
import { fakeScreenshot } from "../helpers/images";
import { MemoryStorage } from "../helpers/memory-storage";

const conv = { id: "c1", timezone: "America/Sao_Paulo", createdAt: new Date("2026-10-25T15:00:00Z") } as Conversation;
const noop = async () => {};

/** Visão falsa: cada imagem do lote vira duas mensagens, com sobreposição proposital. */
function visionTransport(seen: ChatRequest[]): ChatTransport {
  let call = 0;
  return async (req) => {
    seen.push(req);
    const user = req.messages[1]!;
    const n = Array.isArray(user.content) ? user.content.filter((p) => p.type === "image_url").length : 0;
    const base = call;
    call += n;
    const images = Array.from({ length: n }, (_, i) => {
      const k = base + i;
      return {
        index: i,
        app: "whatsapp",
        chat_title: "Ana",
        messages: [
          ...(k > 0 ? [{ side: "right", text: `resposta ${k - 1}`, time: "10:0" + ((k - 1) % 10), kind: "text" }] : [{ side: "center", kind: "system", text: "Hoje", day_label: "Hoje" }]),
          { side: "left", text: `pergunta ${k}`, time: "10:0" + (k % 10), kind: "text" },
          { side: "right", text: `resposta ${k}`, time: "10:0" + (k % 10), kind: "text" },
        ],
      };
    });
    return { content: JSON.stringify({ images }), finishReason: "stop", usage: { promptTokens: 1, completionTokens: 1 }, model: req.model, headers: new Headers() };
  };
}

describe("ingestão de prints e .zip (IA e storage simulados)", () => {
  let seen: ChatRequest[];
  beforeEach(() => {
    seen = [];
    setAiClientForTests(new AiClient({ transport: visionTransport(seen), limiter: new NoopRateLimiter(), sleep: async () => {} }));
    setStorageForTests(new MemoryStorage());
  });
  afterEach(() => {
    setAiClientForTests(undefined);
    setStorageForTests(undefined);
  });

  it("prints: lotes de até 3 imagens, costura, remetentes esquerda/direita e progresso", async () => {
    const files = await Promise.all([1, 2, 3, 4, 5].map(async (seed) => ({ data: await fakeScreenshot({ seed }) })));
    const progress: string[] = [];
    const out = await ingestImages(conv, files, async (step, c, t) => void progress.push(`${step}:${c ?? ""}/${t ?? ""}`));
    expect(seen).toHaveLength(2); // 3 + 2
    expect(seen.every((r) => r.model === process.env.GROQ_VISION_MODEL)).toBe(true);
    const texts = out.normalized.messages.filter((m) => m.kind === "text").map((m) => m.content);
    // sem duplicatas da sobreposição
    expect(new Set(texts).size).toBe(texts.length);
    expect(texts).toContain("pergunta 4");
    expect(out.normalized.senders.map((s) => s.raw).sort()).toEqual(["Ana", "Pessoa da direita"]);
    expect(out.normalized.senders.find((s) => s.raw === "Ana")!.side).toBe("left");
    expect(out.normalized.hasTimestamps).toBe(true);
    expect(progress).toContain("ocr:5/5");
    // As imagens vão re-encodadas em JPEG (data URL), nunca o arquivo original.
    const firstImage = (seen[0]!.messages[1]!.content as { type: string; image_url?: { url: string } }[]).find((p) => p.type === "image_url");
    expect(firstImage!.image_url!.url.startsWith("data:image/jpeg;base64,")).toBe(true);
  });

  it("zip da exportação do WhatsApp com mídia: usa só o _chat.txt", async () => {
    const chat = "23/10/2026 14:05 - Ana: oi\n23/10/2026 14:06 - Lucas: oi Ana\n23/10/2026 14:07 - Ana: tudo bem?\n";
    const zip = buildZip([
      { name: "IMG-20261023-WA0001.jpg", data: await fakeScreenshot({ format: "jpeg" }) },
      { name: "_chat.txt", data: Buffer.from(chat), deflate: true },
    ]);
    await putEncrypted("uploads/c1/zip", zip);
    const out = await ingestZip(conv, "uploads/c1/zip", noop);
    expect(out.sourceType).toBe("zip_whatsapp");
    expect(out.normalized.messages).toHaveLength(3);
    expect(seen).toHaveLength(0); // nada de OCR
  });

  it("zip de prints: ordem natural dos nomes e só imagens de verdade", async () => {
    const zip = buildZip([
      { name: "Screenshot_10.png", data: await fakeScreenshot({ seed: 10 }) },
      { name: "Screenshot_2.png", data: await fakeScreenshot({ seed: 2 }) },
      { name: "falsa.png", data: Buffer.from("não sou png") },
      { name: "__MACOSX/._Screenshot_2.png", data: Buffer.from("x") },
    ]);
    await putEncrypted("uploads/c1/zip2", zip);
    const out = await ingestZip(conv, "uploads/c1/zip2", noop);
    expect(out.sourceType).toBe("zip_images");
    expect(seen).toHaveLength(1);
    const n = (seen[0]!.messages[1]!.content as { type: string }[]).filter((p) => p.type === "image_url").length;
    expect(n).toBe(2);
  });

  it("zip sem conversa nem prints → erro amigável; originais continuam cifrados no storage", async () => {
    const zip = buildZip([{ name: "leia-me.md", data: Buffer.from("x") }]);
    await putEncrypted("uploads/c1/zip3", zip);
    const err = await ingestZip(conv, "uploads/c1/zip3", noop).catch((e: unknown) => e);
    expect((err as IngestError).code).toBe("zip_empty");
    const raw = await (await getStorage()).get("uploads/c1/zip3");
    expect(raw.subarray(0, 4).toString()).toBe("PDA1");
  });
});
