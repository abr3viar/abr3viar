import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as chunk from "@/server/ai/prompts/chunk-summary";
import * as extra from "@/server/ai/prompts/extra-report";
import * as main from "@/server/ai/prompts/main-report";
import * as vision from "@/server/ai/prompts/vision-extract";
import { CATALOG } from "@/server/reports/catalog";

const readme = readFileSync("src/server/ai/prompts/README.md", "utf8");

describe("versões e histórico dos prompts", () => {
  it("cada PROMPT_VERSION atual está registrado no README, na seção do prompt", () => {
    for (const version of [chunk.PROMPT_VERSION, extra.PROMPT_VERSION, main.PROMPT_VERSION, vision.PROMPT_VERSION]) {
      const [name, rev] = version.split("@");
      const section = readme.slice(readme.indexOf(`### ${name}`));
      expect(section, version).toContain(`**${rev}**`);
    }
  });

  it("versões desta rodada (IA-5 a IA-15)", () => {
    expect(main.PROMPT_VERSION).toBe("main-report@2026-10-25.3");
    expect(extra.PROMPT_VERSION).toBe("extra-report@2026-10-25.2");
    expect(chunk.PROMPT_VERSION).toBe("chunk-summary@2026-10-25.4");
    expect(vision.PROMPT_VERSION).toBe("vision-extract@2026-10-25.1");
  });
});

describe("frases que o mock do E2E usa para reconhecer cada prompt", () => {
  it("continuam presentes", () => {
    expect(vision.visionSystemPrompt()).toContain("extrator de texto de capturas de tela");
    expect(chunk.chunkSummarySystemPrompt()).toContain("anotações objetivas sobre um TRECHO");
    expect(chunk.notesMergeSystemPrompt()).toContain("condensá-las em UMA nota");
    expect(main.sectionRegenPrompt("virada", [{ key: "retrato", title: "x" }])).toMatch(/Gere SOMENTE a seção "virada"/);
    expect(extra.extraSectionRegenPrompt("caminhos", "", [])).toMatch(/Gere SOMENTE a seção "caminhos"/);
    expect(main.hookOnlyPrompt([])).toContain('Escreva SOMENTE o "hook"');
    expect(extra.extraSystemPrompt({ name: "X", template: "", slug: "x" })).toContain("RELATÓRIO ADICIONAL");
    expect(CATALOG.find((c) => c.slug === "quem-gosta-mais")!.promptTemplate).toContain("VERDICT (obrigatório)");
  });
});

describe("conteúdo das regras", () => {
  const system = main.mainReportSystemPrompt();

  it("linguagem de possibilidade, sem rótulos e sem controle do parceiro", () => {
    expect(system).toContain('"pode indicar"');
    expect(system).toContain('"narcisista"');
    expect(system).toMatch(/olhar o celular, checar localização/);
    expect(system).toContain("testar ciúme");
  });

  it("briefs das seções grátis não pedem interpretação de interesse", () => {
    const ritmo = main.MAIN_SECTIONS.find((s) => s.key === "ritmo")!;
    expect(ritmo.brief).toContain("Não traduza esses números em quem gosta/se importa/investe mais");
    expect(main.MAIN_SECTIONS.find((s) => s.key === "estilos")!.brief).toContain("sem antecipar");
  });

  it("regeneração de seção paga não leva o aviso de seção gratuita", () => {
    expect(main.sectionRegenPrompt("virada")).not.toContain("Esta seção é gratuita");
    expect(main.sectionRegenPrompt("retrato")).toContain("Esta seção é gratuita");
  });
});
