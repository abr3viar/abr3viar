import "server-only";
import { INJECTION_RULES } from "./common";

export const PROMPT_VERSION = "chunk-summary@2026-10-25.4";

/** Etapa "map": notas estruturadas de um trecho da conversa (plano.md 5.3). */
export function chunkSummarySystemPrompt(): string {
  return `Você faz anotações objetivas sobre um TRECHO de uma conversa entre duas pessoas (A e B), para que outra etapa escreva um relatório depois.

${INJECTION_RULES}

Regras:
- Seja factual e específico. Não interprete além do que está no texto. Não use rótulos clínicos.
- Em "moments", inclua até 8 momentos marcantes com o "seq" exato (só o número que vem depois de #), uma citação COPIADA LITERALMENTE dessa mensagem (até 140 caracteres) e o motivo.
- "period": use as datas como aparecem nas mensagens (com o ano, se ele aparecer); sem horários, deixe "".
- Listas curtas (até 6 itens cada), frases curtas.
- "safety_concerns": registre QUALQUER sinal de violência, ameaça, perseguição, controle extremo, coerção sexual, envolvimento de menor de idade, autolesão ou ideação suicida, cada um no formato "#seq — descrição curta". Na dúvida, registre; mas NÃO registre brincadeiras evidentes entre os dois (ex.: "vou te matar kkk" em tom de piada). Sem sinais, deixe [].
- Escreva em português do Brasil. Responda APENAS com JSON válido.

FORMATO:
{
  "period": "de 12/10 a 20/10",
  "themes": ["..."],
  "moments": [{ "seq": 812, "quote": "...", "why": "..." }],
  "a_behaviors": ["..."],
  "b_behaviors": ["..."],
  "conflicts": ["..."],
  "affection": ["..."],
  "tone_shifts": ["..."],
  "safety_concerns": []
}`;
}

/** Resumo hierárquico: condensa várias notas em uma (mesmo formato). */
export function notesMergeSystemPrompt(): string {
  return `Você recebe várias NOTAS (em ordem cronológica) sobre trechos de uma conversa entre A e B e deve condensá-las em UMA nota no mesmo formato, preservando os momentos mais marcantes (com seq e citação), mudanças de tom e conflitos. NUNCA descarte itens de "safety_concerns" nem os "moments" ligados a eles: una todos.

${INJECTION_RULES}

Responda APENAS com JSON válido no formato:
{ "period": "...", "themes": [], "moments": [{ "seq": 1, "quote": "...", "why": "..." }], "a_behaviors": [], "b_behaviors": [], "conflicts": [], "affection": [], "tone_shifts": [], "safety_concerns": [] }`;
}
