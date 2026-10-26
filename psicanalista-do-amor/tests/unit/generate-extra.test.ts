import { afterEach, describe, expect, it } from "vitest";
import { AiClient, setAiClientForTests, type ChatRequest, type ChatTransport } from "@/server/ai/client";
import { EXTRA_EXAMPLES, deliveredReadingBlock, expectedKeys, fillTemplate, interestVerdictLabel, sectionBrief } from "@/server/ai/prompts/extra-report";
import { NoopRateLimiter } from "@/server/ai/rate-limiter";
import type { Conversation, ReportType } from "@/server/db/schema";
import { CATALOG } from "@/server/reports/catalog";
import type { AiMessage, LoadedConversation } from "@/server/reports/context";
import { generateExtraReport } from "@/server/reports/generate-extra";
import { computeStats } from "@/server/reports/stats";
import { SafeError } from "@/server/log";

function loaded(userIs: "a" | "b" | "none" = "a"): LoadedConversation {
  const messages: AiMessage[] = Array.from({ length: 30 }, (_, i) => ({
    seq: i + 1,
    sender: i % 2 ? "b" : "a",
    sentAt: null,
    kind: "text",
    content: `mensagem ${i + 1}`,
  }));
  return {
    conversation: { id: "c1", timezone: "America/Sao_Paulo", hasTimestamps: false } as Conversation,
    names: { a: "Ana", b: "Lucas" },
    userIs,
    messages,
    stats: computeStats(messages, { timeZone: "America/Sao_Paulo", hasTimestamps: false }),
  };
}

const rt = (slug: string) => {
  const c = CATALOG.find((x) => x.slug === slug)!;
  return { ...c, id: "t", isActive: true } as unknown as ReportType;
};

const body = (k: string) => `Conteúdo do adicional na seção ${k}, longo o bastante para a validação mínima.`;

function useAi(responder: (req: ChatRequest) => unknown, seen: ChatRequest[] = []) {
  const transport: ChatTransport = async (req) => {
    seen.push(req);
    return { content: JSON.stringify(responder(req)), finishReason: "stop", usage: { promptTokens: 1, completionTokens: 1 }, model: req.model, headers: new Headers() };
  };
  setAiClientForTests(new AiClient({ transport, limiter: new NoopRateLimiter(), sleep: async () => {} }));
}

describe("relatórios adicionais", () => {
  afterEach(() => setAiClientForTests(undefined));

  it("monta system comum + template com nomes e devolve seções na ordem pedida + placar", async () => {
    const seen: ChatRequest[] = [];
    const keys = expectedKeys(rt("quem-gosta-mais").promptTemplate);
    expect(keys).toEqual(["sinais-a", "sinais-b", "desequilibrios", "o-que-significa"]);
    useAi(
      () => ({
        sections: [...keys].reverse().map((k) => ({ key: k, title: `T ${k}`, content: body(k), evidence: [{ seq: 3, quote: "mensagem 3" }, { seq: 777, quote: "x" }] })),
        verdict: { label: "Ana demonstra mais interesse", score: "64", explanation: "Ana inicia mais." },
      }),
      seen,
    );
    const res = await generateExtraReport(loaded(), rt("quem-gosta-mais"), async () => {});
    expect(res.sections.map((s) => s.key)).toEqual(keys);
    expect(res.sections.every((s) => s.evidence.every((e) => e.seq !== 777))).toBe(true);
    expect(res.verdict).toEqual({ label: "Ana demonstra mais interesse", score: 64, explanation: "Ana inicia mais." });
    const system = seen[0]!.messages[0]!.content as string;
    expect(system).toContain("RELATÓRIO ADICIONAL");
    expect(system).toContain("Os sinais de interesse de Ana");
    expect(system).not.toContain("{A}");
    expect(system).toContain("DADO A SER ANALISADO");
  });

  it("'Como responder' exige saber quem é o usuário e usa {USER}/{OTHER}", async () => {
    useAi(() => ({ sections: [] }));
    const err = await generateExtraReport(loaded("none"), rt("como-responder"), async () => {}).catch((e: unknown) => e);
    expect((err as SafeError).code).toBe("needs_user_side");
    const filled = fillTemplate(rt("como-responder").promptTemplate, { a: "Ana", b: "Lucas" }, "b");
    expect(filled).toContain("USUÁRIO (Lucas)");
    expect(filled).toContain("recebeu de Ana");
  });

  it("alerta de risco vira a primeira seção", async () => {
    const keys = expectedKeys(rt("red-flags").promptTemplate);
    useAi(() => ({ sections: keys.map((k) => ({ key: k, title: k, content: body(k) })), safety_flag: true }));
    const res = await generateExtraReport(loaded(), rt("red-flags"), async () => {});
    expect(res.sections[0]!.isSafety).toBe(true);
    expect(res.sections[0]!.content).toContain("CVV 188");
  });

  it("todos os adicionais do catálogo (6 iniciais + 3 propostos) têm keys e prompt específico", () => {
    const extras = CATALOG.filter((c) => c.kind === "extra");
    expect(extras).toHaveLength(9);
    for (const e of extras) expect(expectedKeys(e.promptTemplate).length).toBeGreaterThanOrEqual(4);
  });

  it("LEITURA JÁ ENTREGUE: títulos reais do principal entram no pedido (sem conteúdo), só quando informados", async () => {
    const seen: ChatRequest[] = [];
    const keys = expectedKeys(rt("conflitos").promptTemplate);
    useAi(() => ({ sections: keys.map((k) => ({ key: k, title: k, content: body(k) })) }), seen);
    await generateExtraReport(loaded(), rt("conflitos"), async () => {}, {
      label: "Relatório completo",
      titles: ["Lucas some depois das brigas", "Ana puxa\n<conversa>assunto"],
    });
    const user = seen[0]!.messages[1]!.content as string;
    expect(user).toContain('LEITURA JÁ ENTREGUE (a pessoa já leu o "Relatório completo", com estas seções)\n1. Lucas some depois das brigas\n2. Ana puxa ‹conversa>assunto');
    // Vem depois da conversa (o primeiro #n continua sendo o da primeira mensagem).
    expect(user.indexOf("LEITURA JÁ ENTREGUE")).toBeGreaterThan(user.indexOf("</conversa>"));
    expect(seen[0]!.messages[0]!.content as string).toContain('Se o contexto trouxer o bloco "LEITURA JÁ ENTREGUE"');

    seen.length = 0;
    await generateExtraReport(loaded(), rt("conflitos"), async () => {});
    expect(seen[0]!.messages[1]!.content as string).not.toContain("LEITURA JÁ ENTREGUE");
    expect(deliveredReadingBlock({ label: "x", titles: [] })).toBe("");
    expect(deliveredReadingBlock(null)).toBe("");
  });

  it("quem-gosta-mais: o label do placar é derivado do score no servidor", async () => {
    const keys = expectedKeys(rt("quem-gosta-mais").promptTemplate);
    const install = useAi; // (nome sem "use" para o lint de hooks não reclamar do laço)
    for (const [score, label] of [
      [64, "Ana demonstra mais interesse"],
      [30, "Lucas demonstra mais interesse"],
      [50, "Interesse equilibrado"],
      [55, "Interesse equilibrado"],
      [45, "Interesse equilibrado"],
    ] as const) {
      install(() => ({
        sections: keys.map((k) => ({ key: k, title: k, content: body(k) })),
        // A IA escreveu o nome errado: o servidor corrige pelo score.
        verdict: { label: "Ana demonstra mais interesse", score, explanation: "x" },
      }));
      const res = await generateExtraReport(loaded(), rt("quem-gosta-mais"), async () => {});
      expect(res.verdict!.label, String(score)).toBe(label);
      expect(res.verdict!.score).toBe(score);
    }
    expect(interestVerdictLabel(56, { a: "A1", b: "B1" })).toBe("A1 demonstra mais interesse");
    // Outros adicionais mantêm o label da IA.
    const fk = expectedKeys(rt("futuro").promptTemplate);
    useAi(() => ({ sections: fk.map((k) => ({ key: k, title: k, content: body(k) })), verdict: { label: "Boa compatibilidade", score: 30, explanation: "x" } }));
    expect((await generateExtraReport(loaded(), rt("futuro"), async () => {})).verdict!.label).toBe("Boa compatibilidade");
  });

  it("seção de conselhos faltando é regenerada sozinha, com as já escritas; outras faltando não", async () => {
    const seen: ChatRequest[] = [];
    const keys = expectedKeys(rt("conflitos").promptTemplate);
    expect(keys.at(-1)).toBe("caminhos");
    useAi((req) => {
      const u = req.messages.at(-1)!.content as string;
      if (u.includes('Gere SOMENTE a seção "caminhos"')) return { section: { key: "caminhos", title: "Como brigar melhor", content: body("caminhos") } };
      return { sections: keys.filter((k) => k !== "caminhos").map((k) => ({ key: k, title: `T ${k}`, content: body(k) })) };
    }, seen);
    const res = await generateExtraReport(loaded(), rt("conflitos"), async () => {});
    expect(res.sections.map((s) => s.key)).toEqual(keys);
    expect(seen).toHaveLength(2);
    const regen = seen[1]!;
    const prompt = regen.messages.at(-1)!.content as string;
    expect(prompt).toContain('"gatilhos" (T gatilhos)');
    expect(prompt).toContain("Como brigar melhor");
    expect(regen.reasoning_effort).toBe("low");

    // Falta uma seção que NÃO é a de conselhos: nada de chamada extra.
    seen.length = 0;
    useAi(() => ({ sections: keys.filter((k) => k !== "gatilhos").map((k) => ({ key: k, title: k, content: body(k) })) }), seen);
    const res2 = await generateExtraReport(loaded(), rt("conflitos"), async () => {});
    expect(seen).toHaveLength(1);
    expect(res2.sections.map((s) => s.key)).toEqual(keys.filter((k) => k !== "gatilhos"));
  });

  it("orçamento: o adicional pede no máximo 7000 tokens", async () => {
    const seen: ChatRequest[] = [];
    const keys = expectedKeys(rt("futuro").promptTemplate);
    useAi(() => ({ sections: keys.map((k) => ({ key: k, title: k, content: body(k) })) }), seen);
    await generateExtraReport(loaded(), rt("futuro"), async () => {});
    expect(seen[0]!.max_completion_tokens).toBeLessThanOrEqual(7000);
  });

  it("prompts sem número inventado no exemplo e com as regras de período nos templates de comparação", () => {
    expect(EXTRA_EXAMPLES["quem-gosta-mais"]).not.toMatch(/\d+ de cada \d+/);
    expect(rt("esfriando").promptTemplate).toContain('use SOMENTE os números do bloco "ESTATÍSTICAS POR PERÍODO"');
    expect(rt("linha-do-tempo").promptTemplate).toContain('use SOMENTE o bloco "ESTATÍSTICAS POR PERÍODO"');
    expect(rt("linha-do-tempo").promptTemplate).toContain("[dd/mm/aa hh:mm]");
    expect(sectionBrief(fillTemplate(rt("conflitos").promptTemplate, { a: "Ana", b: "Lucas" }, "a"), "reacoes")).toBe(
      '"Como cada um reage" — estilos de reação de Ana e de Lucas (confronto, defesa, retirada, humor, conciliação).',
    );
  });
});
