import { describe, expect, it } from "vitest";
import { detectFileKind } from "@/server/ingest/detect";
import { prepareImage } from "@/server/ingest/images";

/**
 * QA-08: D52 diz que HEIC/HEVC não é suportado e que "o envio retorna erro amigável", mas o
 * upload ACEITA HEIC (detectFileKind → image/heic; o formulário até anuncia "PNG, JPG, WEBP
 * ou HEIC"). O erro só aparece no worker, depois do envio, e derruba o lote inteiro de prints
 * (falha permanente → originais apagados → "Tentar de novo" sem saída, ver QA-01).
 */

// Cabeçalho ISO-BMFF mínimo com brand "heic" (arquivo fictício, sem imagem real).
const FAKE_HEIC = Buffer.concat([
  Buffer.from([0, 0, 0, 0x18]),
  Buffer.from("ftypheic"),
  Buffer.from([0, 0, 0, 0]),
  Buffer.from("mif1heic"),
  Buffer.alloc(256, 1),
]);

describe("QA-08 — HEIC no envio", () => {
  it("pré-condição: o processamento recusa HEIC (só no worker)", async () => {
    await expect(prepareImage(FAKE_HEIC)).rejects.toMatchObject({ name: "IngestError" });
  });

  it("QA-08: o upload recusa HEIC na hora, com o código heic_unsupported", async () => {
    await expect(detectFileKind(FAKE_HEIC)).rejects.toMatchObject({ code: "heic_unsupported" });
  });
});
