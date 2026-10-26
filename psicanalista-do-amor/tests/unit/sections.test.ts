import { describe, expect, it } from "vitest";
import {
  DEFAULT_SAFETY_CONTENT,
  quoteMatches,
  safetyContent,
  sanitizeEvidence,
  textMessagesBySeq,
} from "@/server/reports/sections";

const msgs = textMessagesBySeq([
  { seq: 1, sender: "a", kind: "text", content: "Oi! Chegou bem em casa?" },
  { seq: 2, sender: "b", kind: "text", content: "cheguei sim\ne você?" },
  { seq: 3, sender: "a", kind: "audio", content: "" },
  { seq: 4, sender: "a", kind: "media_omitted", content: "<Mídia oculta>" },
  { seq: 5, sender: "a", kind: "text", content: "eu acho que a gente precisa conversar sobre o fim de semana, porque eu fiquei chateada" },
  { seq: 6, sender: "b", kind: "text", content: "ok, assim fica melhor" },
  { seq: 7, sender: "a", kind: "text", content: "saudade ".repeat(40).trim() },
  { seq: 8, sender: "a", kind: "text", content: "Oi! Chegou bem em casa?" },
]);

describe("citações conferidas contra a mensagem real (IA-9 + revisão)", () => {
  it("só mensagens de texto entram no mapa, com o remetente", () => {
    expect([...msgs.keys()]).toEqual([1, 2, 5, 6, 7, 8]);
    expect(msgs.get(2)).toEqual({ sender: "b", content: "cheguei sim\ne você?" });
  });

  it("compara por palavras inteiras, sem caixa, aspas e pontuação, com a quebra de linha do prompt", () => {
    expect(quoteMatches("chegou bem em casa", "Oi! Chegou bem em casa?")).toBe(true);
    expect(quoteMatches("“Chegou bem em casa?”", "Oi! Chegou bem em casa?")).toBe(true);
    expect(quoteMatches("cheguei sim / e você?", "cheguei sim\ne você?")).toBe(true);
    expect(quoteMatches("eu acho… fiquei chateada", msgs.get(5)!.content)).toBe(true);
    expect(quoteMatches("eu nunca disse isso", msgs.get(5)!.content)).toBe(false);
    expect(quoteMatches("...", msgs.get(5)!.content)).toBe(false);
    // "sim" não casa com "assim"; trecho curto demais (1 palavra < 8 letras) não vale
    expect(quoteMatches("sim fica", "ok, assim fica melhor")).toBe(false);
    expect(quoteMatches("ok", "ok, assim fica melhor")).toBe(false);
  });

  it("mantém a citação literal; DESCARTA a inventada (nunca troca por outro texto); ignora mídia/áudio e seq inexistente", () => {
    const out = sanitizeEvidence(
      [
        { seq: 1, quote: "chegou bem em casa?" },
        { seq: 3, quote: "áudio carinhoso" },
        { seq: 4, quote: "foto" },
        { seq: 999, quote: "não existe" },
        { seq: 5, quote: "você nunca liga pra mim" },
      ],
      msgs,
    );
    expect(out).toEqual([{ seq: 1, quote: "chegou bem em casa?" }]);
  });

  it("corrige seq errado por pouco só para a vizinha DO MESMO remetente", () => {
    // #2 é de B; a frase está em #1 (de A) → não pode virar citação de A atribuída por engano
    expect(sanitizeEvidence([{ seq: 2, quote: "Oi! Chegou bem em casa?" }], msgs)).toEqual([]);
    // #7 é de A; a frase está em #8 (também de A) → corrige
    expect(sanitizeEvidence([{ seq: 7, quote: "Oi! Chegou bem em casa?" }], msgs)).toEqual([{ seq: 8, quote: "Oi! Chegou bem em casa?" }]);
  });

  it("citação longa é cortada em 140 caracteres; máximo 3 e sem repetir mensagem", () => {
    const [long] = sanitizeEvidence([{ seq: 7, quote: "saudade ".repeat(25).trim() }], msgs);
    expect(long!.quote).toHaveLength(140);
    expect(long!.quote.endsWith("…")).toBe(true);
    const many = sanitizeEvidence(
      [
        { seq: 1, quote: "chegou bem" },
        { seq: 1, quote: "bem em casa" },
        { seq: 2, quote: "cheguei sim" },
        { seq: 5, quote: "fiquei chateada" },
        { seq: 8, quote: "chegou bem" },
      ],
      msgs,
    );
    expect(many.map((e) => e.seq)).toEqual([1, 2, 5]);
  });
});

describe("texto do alerta de risco", () => {
  it("o padrão traz 180, 188, 190 e o Disque 100 (criança ou adolescente)", () => {
    expect(DEFAULT_SAFETY_CONTENT).toContain("Ligue 180");
    expect(DEFAULT_SAFETY_CONTENT).toContain("CVV 188");
    expect(DEFAULT_SAFETY_CONTENT).toContain("**190**");
    expect(DEFAULT_SAFETY_CONTENT).toMatch(/Disque 100\*\* — .*criança ou adolescente/);
  });

  it("acrescenta os contatos padrão quando falta algum; não duplica quando a IA listou todos", () => {
    const partial = "Há ameaças explícitas. Ligue 180 ou CVV 188.";
    expect(safetyContent(partial)).toContain(DEFAULT_SAFETY_CONTENT);
    const all = "Há ameaças. Ligue 180, CVV 188, 190 ou Disque 100.";
    expect(safetyContent(all)).toBe(all);
  });
});
