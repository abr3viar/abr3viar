/**
 * Quatro conversas FICTÍCIAS (casal tranquilo, conflito, distanciamento e um caso com sinal
 * de risco) com respostas da IA simuladas em formatos "tortos" que a IA às vezes devolve:
 * cobre o parse tolerante, a conferência das citações e a montagem das seções.
 */
import { afterEach, describe, expect, it } from "vitest";
import { AiClient, setAiClientForTests, type ChatRequest, type ChatTransport } from "@/server/ai/client";
import { NoopRateLimiter } from "@/server/ai/rate-limiter";
import type { Conversation, ReportType } from "@/server/db/schema";
import { CATALOG } from "@/server/reports/catalog";
import type { AiMessage, LoadedConversation } from "@/server/reports/context";
import { generateExtraReport } from "@/server/reports/generate-extra";
import { generateMainReport } from "@/server/reports/generate-main";
import { computeFreeFlags } from "@/server/reports/sections";
import { computeStats } from "@/server/reports/stats";

const KEYS = ["retrato", "ritmo", "temas", "estilos", "virada", "investimento", "pontos-de-atrito", "leitura-final"];
const TZ = "America/Sao_Paulo";

/** Linhas "A|B: texto" com 1 minuto entre elas (ou o intervalo dado em minutos). */
function conversation(lines: (string | [string, number])[], names = { a: "Bia", b: "Caio" }): LoadedConversation {
  let t = Date.UTC(2026, 6, 1, 13, 0);
  const messages: AiMessage[] = lines.map((l, i) => {
    const [line, gap] = typeof l === "string" ? [l, 1] : l;
    t += gap * 60_000;
    const sender = line.startsWith("A:") ? "a" : "b";
    const content = line.slice(2).trim();
    return { seq: i + 1, sender, sentAt: new Date(t), kind: content === "<áudio>" ? "audio" : "text", content };
  });
  return {
    conversation: { id: "conv", timezone: TZ, hasTimestamps: true } as Conversation,
    names,
    userIs: "a",
    messages,
    stats: computeStats(messages, { timeZone: TZ, hasTimestamps: true }),
  };
}

const para = (s: string) => `${s} A conversa sugere um jeito próprio dos dois de se falar, com detalhes do dia a dia e respostas que se encaixam.`;

function useAi(responder: (req: ChatRequest) => unknown, seen: ChatRequest[] = []) {
  const transport: ChatTransport = async (req) => {
    seen.push(req);
    return { content: JSON.stringify(responder(req)), finishReason: "stop", usage: { promptTokens: 10, completionTokens: 10 }, model: req.model, headers: new Headers() };
  };
  setAiClientForTests(new AiClient({ transport, limiter: new NoopRateLimiter(), sleep: async () => {} }));
}

const rt = (slug: string) => ({ ...CATALOG.find((c) => c.slug === slug)!, id: "t", isActive: true }) as unknown as ReportType;
const noop = async () => {};

describe("cenários fictícios: relatório principal e adicionais", () => {
  afterEach(() => setAiClientForTests(undefined));

  it("casal tranquilo: seq com '#', content em lista e citações literais preservadas", async () => {
    const l = conversation([
      "A: bom dia! dormiu bem?",
      "B: dormi sim, sonhei com a praia de novo kkkk",
      "A: aquela de Ubatuba? bora voltar em setembro",
      "B: bora!! já vou ver pousada",
      "A: te amo, bobo",
      "B: também te amo ❤️",
    ]);
    useAi(() => ({
      sections: KEYS.map((k) => ({
        key: k,
        title: `Título ${k}`,
        locked_title: "O detalhe que passa despercebido",
        content: [para(`Bia e Caio planejam Ubatuba (${k}).`), "Segundo parágrafo com o humor dos dois."],
        evidence: [{ seq: "#3", quote: "bora voltar em setembro" }],
      })),
      hook: "Mas há algo no jeito como Caio responde aos planos que vale olhar de perto…",
      safety_flag: "false",
    }));
    const res = await generateMainReport(l, noop);
    expect(res.safetyFlag).toBe(false);
    expect(res.sections.map((s) => s.key)).toEqual(KEYS);
    expect(res.sections[0]!.content).toContain("\n\nSegundo parágrafo");
    expect(res.sections[0]!.evidence).toEqual([{ seq: 3, quote: "bora voltar em setembro" }]);
    expect(res.hook).toContain("Caio");
    expect(computeFreeFlags(res.sections, "main")).toEqual([true, true, true, true, false, false, false, false]);
  });

  it("conflito: sections como objeto, keys fora do padrão e citação parafraseada descartada", async () => {
    const l = conversation([
      "A: você disse que vinha às 20h",
      ["B: o trânsito tava horrível, não é culpa minha", 90],
      "A: é sempre o trânsito",
      "B: lá vem você de novo",
      "A: só queria que você avisasse",
      ["B: tá, desculpa. da próxima eu aviso", 30],
    ]);
    useAi(() => ({
      sections: Object.fromEntries(
        ["Retrato", "Ritmo", "Temas", "Estilos", "Virada", "Investimento", "Pontos_de atrito", "Leitura Final"].map((k) => [
          k,
          { title: `Sobre ${k}`, content: para(`Os atrasos aparecem como tema (${k}).`), evidence: [{ seq: 3, quote: "você sempre culpa o trânsito" }] },
        ]),
      ),
      hook: "Mas há algo no jeito como Bia volta ao assunto que muda a leitura…",
    }));
    const res = await generateMainReport(l, noop);
    expect(res.sections.map((s) => s.key)).toEqual(KEYS);
    expect(res.sections.find((s) => s.key === "pontos-de-atrito")!.title).toBe("Sobre Pontos_de atrito");
    // A IA "citou" algo que ninguém escreveu: vira o texto real da mensagem #3.
    // (Revisão: paráfrase não é citação — é descartada em vez de trocada pelo trecho real.)
    expect(res.sections[0]!.evidence).toEqual([]);

    // Adicional "Padrões de conflito" com a mesma conversa.
    const keys = ["gatilhos", "reacoes", "desfechos", "caminhos"];
    useAi(() => ({
      sections: keys.map((k) => ({ key: k.toUpperCase(), title: k, content: para(`Atrasos e avisos (${k}).`), evidence: [{ seq: "#4", quote: "lá vem você de novo" }] })),
      verdict: null,
    }));
    const extra = await generateExtraReport(l, rt("conflitos"), noop);
    expect(extra.sections.map((s) => s.key)).toEqual(keys);
    expect(extra.sections[1]!.evidence).toEqual([{ seq: 4, quote: "lá vem você de novo" }]);
    expect(extra.verdict).toBeNull();
  });

  it("distanciamento: o 'Está esfriando?' recebe as estatísticas por período e só com elas compara", async () => {
    const lines: (string | [string, number])[] = [];
    for (let i = 0; i < 30; i++) lines.push(i % 2 ? "B: saudade de você, amor ❤️ como foi o dia?" : "A: oi amor, tô com saudade! e aí, como foi?");
    for (let i = 0; i < 30; i++) lines.push(i % 2 ? ["B: ok", 240] : ["A: oi, tudo bem?", 180]);
    const l = conversation(lines);
    const seen: ChatRequest[] = [];
    const keys = ["como-era", "como-esta", "o-que-mudou", "o-que-fazer"];
    useAi(
      () => ({
        sections: keys.map((k) => ({ key: k, title: k, content: para(`Começo e fim comparados (${k}).`), evidence: [{ seq: 60, quote: "ok" }] })),
        verdict: { label: "Esfriando", score: "22", explanation: "Menos carinho e respostas mais lentas no último terço." },
      }),
      seen,
    );
    const res = await generateExtraReport(l, rt("esfriando"), noop);
    const user = seen[0]!.messages[1]!.content as string;
    expect(user).toContain("ESTATÍSTICAS POR PERÍODO");
    expect(user).toMatch(/PRIMEIRO TERÇO[\s\S]*palavras de carinho: A \(Bia\) = \d+; B \(Caio\) = \d+[\s\S]*ÚLTIMO TERÇO[\s\S]*palavras de carinho: A \(Bia\) = 0; B \(Caio\) = 0/);
    expect(user).not.toContain("AMOSTRA CURTA");
    expect(res.verdict).toEqual({ label: "Esfriando", score: 22, explanation: "Menos carinho e respostas mais lentas no último terço." });
    // (Revisão: citação de uma palavra curta, como "ok", casa com quase tudo e não sustenta nada.)
    expect(res.sections[0]!.evidence).toEqual([]);
  });

  it("sinal de risco: a IA esquece a flag e escreve a seção 'Alerta' — o alerta vem primeiro, grátis, com os contatos", async () => {
    const l = conversation([
      "A: vou sair com as meninas hoje",
      "B: você não vai a lugar nenhum",
      "A: como assim?",
      "B: se você sair eu vou te machucar",
      "B: e me passa a senha do seu celular",
      "A: <áudio>",
    ]);
    useAi(() => ({
      sections: [
        { key: "Alerta", title: "Cuidado", content: "Há uma ameaça explícita e um pedido de senha do celular, que podem indicar controle.", evidence: [{ seq: 4, quote: "eu vou te machucar" }, { seq: 6, quote: "áudio" }] },
        ...KEYS.map((k) => ({ key: k, title: k, content: para(`Dinâmica de saída (${k}).`) })),
      ],
      hook: "Mas há algo no jeito como Caio reage que muda tudo…",
    }));
    const res = await generateMainReport(l, noop);
    expect(res.safetyFlag).toBe(true);
    expect(res.sections[0]!.key).toBe("alerta");
    expect(res.sections[0]!.isSafety).toBe(true);
    expect(res.sections[0]!.content).toContain("Ligue 180");
    expect(res.sections[0]!.content).toContain("CVV 188");
    // Citação do áudio não vale (não é texto); a da ameaça é literal e fica.
    expect(res.sections[0]!.evidence).toEqual([{ seq: 4, quote: "eu vou te machucar" }]);
    expect(computeFreeFlags(res.sections, "main")[0]).toBe(true);
    expect(res.hook).not.toContain("muda tudo");
    expect(res.hook).toContain("se fizer sentido para você agora");
  });
});
