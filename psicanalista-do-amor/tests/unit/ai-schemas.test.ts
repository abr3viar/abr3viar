import { describe, expect, it } from "vitest";
import { chunkNotesSchema, extraReportSchema, mainReportSchema, normalizeKey } from "@/server/ai/schemas";

describe("schemas tolerantes da IA (IA-14 e IA-9)", () => {
  it("key normalizada: minúsculas, sem acento, _ e espaço viram -", () => {
    expect(normalizeKey("Pontos_de Atrito")).toBe("pontos-de-atrito");
    expect(normalizeKey("  Leitura Final ")).toBe("leitura-final");
    expect(normalizeKey("Mudança__de_tom")).toBe("mudanca-de-tom");
    expect(normalizeKey("RETRATO")).toBe("retrato");
    expect(normalizeKey("sinais-a")).toBe("sinais-a");
  });

  it('seq com "#" (como no prompt) ou em string vira número; seq inválido some', () => {
    const out = mainReportSchema.parse({
      sections: [
        {
          key: "retrato",
          title: "t",
          content: "c",
          evidence: [
            { seq: "#12", quote: "oi" },
            { seq: "# 13", quote: "tudo bem?" },
            { seq: "14", quote: "sim" },
            { seq: "abc", quote: "x" },
            { seq: 15, quote: "" },
          ],
        },
      ],
    });
    expect(out.sections[0]!.evidence).toEqual([
      { seq: 12, quote: "oi" },
      { seq: 13, quote: "tudo bem?" },
      { seq: 14, quote: "sim" },
    ]);
    const notes = chunkNotesSchema.parse({ moments: [{ seq: "#7", quote: "q", why: "w" }] });
    expect(notes.moments[0]!.seq).toBe(7);
  });

  it("content em lista (strings ou {text}) vira texto com parágrafos", () => {
    const out = mainReportSchema.parse({
      sections: [{ key: "ritmo", title: "t", content: ["Primeiro parágrafo.", { text: "Segundo." }, "", 3] }],
    });
    expect(out.sections[0]!.content).toBe("Primeiro parágrafo.\n\nSegundo.\n\n3");
  });

  it("sections como objeto vira lista (a chave do objeto vira key)", () => {
    const out = extraReportSchema.parse({
      sections: {
        "Sinais A": { title: "Os sinais de Ana", content: "texto a" },
        sinais_b: "texto b direto",
        lixo: 42,
        outra: { key: "O_Que_Significa", title: "t", content: "texto c" },
      },
      verdict: null,
    });
    expect(out.sections.map((s) => [s.key, s.content])).toEqual([
      ["sinais-a", "texto a"],
      ["sinais-b", "texto b direto"],
      ["o-que-significa", "texto c"],
    ]);
  });

  it("formato estranho em sections não derruba o resto (lista vazia)", () => {
    const out = mainReportSchema.parse({ sections: "nada", hook: "Mas Ana…", safety_flag: "sim" });
    expect(out.sections).toEqual([]);
    expect(out.hook).toBe("Mas Ana…");
    expect(out.safety_flag).toBe(true);
  });
});
