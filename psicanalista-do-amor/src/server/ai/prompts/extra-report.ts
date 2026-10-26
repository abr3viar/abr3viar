import "server-only";
import { FORMAT_RULES, INJECTION_RULES, SAFETY_RULES, TONE_RULES } from "./common";

export const PROMPT_VERSION = "extra-report@2026-10-25.2";

/** Exemplos curtos de saída por relatório adicional (formato, não conteúdo a copiar). */
export const EXTRA_EXAMPLES: Record<string, string> = {
  "quem-gosta-mais": `{"schema_version":1,"sections":[{"key":"sinais-a","title":"Os sinais de interesse de Ana","content":"Depois dos silêncios, é Ana quem costuma voltar, quase sempre com uma pergunta sobre o dia de Lucas…","evidence":[{"seq":12,"quote":"bom dia, dormiu bem?"}]}],"verdict":{"label":"Ana demonstra mais interesse","score":64,"explanation":"Ana inicia mais conversas e faz mais perguntas."},"safety_flag":false}`,
  "red-flags": `{"schema_version":1,"sections":[{"key":"panorama","title":"Atenção moderada","content":"A conversa tem momentos de cobrança…","evidence":[]}],"verdict":{"label":"Atenção moderada","score":45,"explanation":"Há cobranças frequentes, sem sinais de violência."},"safety_flag":false}`,
  "linguagem-do-amor": `{"schema_version":1,"sections":[{"key":"como-a-demonstra","title":"Ana demonstra afeto com palavras","content":"…","evidence":[]}],"verdict":null,"safety_flag":false}`,
  conflitos: `{"schema_version":1,"sections":[{"key":"gatilhos","title":"Os atrasos acendem a tensão","content":"…","evidence":[]}],"verdict":null,"safety_flag":false}`,
  futuro: `{"schema_version":1,"sections":[{"key":"pontos-fortes","title":"O humor que vocês dividem","content":"…","evidence":[]}],"verdict":{"label":"Boa compatibilidade com ajustes","score":72,"explanation":"…"},"safety_flag":false}`,
  "como-responder": `{"schema_version":1,"sections":[{"key":"resposta-acolhedora","title":"Opção 1 — acolhedora","content":"> \\"Entendo, também senti sua falta. Vamos conversar amanhã?\\"\\n\\nEfeito provável: …","evidence":[]}],"verdict":null,"safety_flag":false}`,
};

/** System comum + parte específica do tipo (plano.md 5.6). */
export function extraSystemPrompt(input: { name: string; template: string; slug: string }): string {
  const example = EXTRA_EXAMPLES[input.slug];
  return `Você escreve um RELATÓRIO ADICIONAL do "Psicanalista do Amor" chamado "${input.name}": uma leitura feita por IA de um aspecto específico da dinâmica entre duas pessoas, a partir da conversa delas.

${INJECTION_RULES}

${TONE_RULES}

PARTE ESPECÍFICA DESTE RELATÓRIO
${input.template}

Cada seção tem "key" (exatamente como pedido), "title" (específico), "content" (100 a 250 palavras) e "evidence".

Se o contexto trouxer o bloco "LEITURA JÁ ENTREGUE", a pessoa já leu aquele relatório: não repita o que aqueles títulos indicam; aprofunde o aspecto deste relatório com evidências novas e, se chegar a uma conclusão diferente, explique o que a sustenta.

${SAFETY_RULES}

${FORMAT_RULES}

FORMATO DE SAÍDA:
{
  "schema_version": 1,
  "sections": [ { "key": "...", "title": "...", "content": "...", "evidence": [{ "seq": 12, "quote": "..." }] } ],
  "verdict": { "label": "...", "score": 64, "explanation": "..." } ou null,
  "safety_flag": false
}${example ? `\n\nEXEMPLO DE FORMATO (não copie o conteúdo):\n${example}` : ""}`;
}

/** Substitui {A}, {B}, {USER} e {OTHER} pelos nomes escolhidos. */
export function fillTemplate(template: string, names: { a: string; b: string }, userIs: "a" | "b" | "none"): string {
  const user = userIs === "a" ? names.a : userIs === "b" ? names.b : "o usuário";
  const other = userIs === "a" ? names.b : userIs === "b" ? names.a : "a outra pessoa";
  return template
    .replaceAll("{A}", names.a)
    .replaceAll("{B}", names.b)
    .replaceAll("{USER}", user)
    .replaceAll("{OTHER}", other);
}

/**
 * Seção de conselhos/próximos passos de cada adicional: se a IA não a escrever, o
 * servidor regenera só ela (é a parte mais acionável do relatório).
 */
export const ADVICE_SECTION_KEY: Record<string, string> = {
  "red-flags": "o-que-fazer",
  "linguagem-do-amor": "desencontros",
  conflitos: "caminhos",
  futuro: "proximos-passos",
  "como-responder": "evitar",
  esfriando: "o-que-fazer",
  "nao-ditos": "como-falar",
};

/** Descrição da seção no template ("key "x": "Título" — o que escrever"). */
export function sectionBrief(template: string, key: string): string {
  const line = template.split("\n").find((l) => l.includes(`key "${key}"`));
  return (line ?? "").replace(/^\s*\d+\.\s*/, "").replace(`key "${key}":`, "").trim();
}

/** Regeneração de UMA seção do adicional, com as já escritas (key + título) para não repetir. */
export function extraSectionRegenPrompt(key: string, template: string, written: { key: string; title: string }[] = []): string {
  const brief = sectionBrief(template, key);
  const done = written.filter((w) => w.key !== key);
  const already = done.length
    ? ` Já escritas (não repita o que elas tratam): ${done.map((w) => `"${w.key}" (${w.title.replace(/\s+/g, " ").trim().slice(0, 120)})`).join("; ")}.`
    : "";
  return `Gere SOMENTE a seção "${key}" deste relatório${brief ? ` (${brief})` : ""}.${already} Responda com {"section": {"key": "${key}", "title": "...", "content": "...", "evidence": []}}.`;
}

export type DeliveredReading = {
  /** Nome do relatório já entregue (ex.: "Relatório completo"). */
  label: string;
  /** Títulos reais das seções (o relatório já foi pago e lido). */
  titles: string[];
};

const cleanLine = (s: string) =>
  s
    .replace(/[\p{Cc}\u2028\u2029]+/gu, " ")
    .replace(/</g, "‹")
    .replace(/#/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);

/** Bloco "LEITURA JÁ ENTREGUE": só títulos (sem o conteúdo), para o adicional não repetir o principal. */
export function deliveredReadingBlock(d: DeliveredReading | null | undefined): string {
  const titles = (d?.titles ?? []).map(cleanLine).filter(Boolean);
  if (!d || titles.length === 0) return "";
  return `LEITURA JÁ ENTREGUE (a pessoa já leu o "${cleanLine(d.label)}", com estas seções)
${titles.map((t, i) => `${i + 1}. ${t}`).join("\n")}`;
}

/** Placar do "quem-gosta-mais": o rótulo vem do score (A em %), nunca do texto da IA. */
export function interestVerdictLabel(score: number, names: { a: string; b: string }): string {
  if (score > 55) return `${names.a} demonstra mais interesse`;
  if (score < 45) return `${names.b} demonstra mais interesse`;
  return "Interesse equilibrado";
}

/** Keys pedidas no template (ex.: key "sinais-a"). */
export function expectedKeys(template: string): string[] {
  return [...template.matchAll(/key "([a-z0-9-]+)"/g)].map((m) => m[1]!).filter((k) => k !== "alerta");
}
