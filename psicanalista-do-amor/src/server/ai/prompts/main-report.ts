import "server-only";
import { FORMAT_RULES, INJECTION_RULES, SAFETY_RULES, TONE_RULES } from "./common";

export const PROMPT_VERSION = "main-report@2026-10-25.3";

/** Seções do relatório principal: ordem fixa (plano.md 5.5). As 4 primeiras são grátis. */
export const MAIN_SECTIONS = [
  { key: "retrato", fallbackTitle: "O retrato de vocês dois", brief: "Retrato do presente da conversa em 1 parágrafo (o que vocês fazem juntos por mensagem, o tom predominante) + 3 palavras que a definem (em negrito). Descreva, não julgue para onde a relação vai." },
  { key: "ritmo", fallbackTitle: "O ritmo da conversa", brief: "Quem fala mais, quem puxa assunto e os tempos de resposta (use ESTATÍSTICAS), descritos como hábitos de conversa. Não traduza esses números em quem gosta/se importa/investe mais." },
  { key: "temas", fallbackTitle: "Sobre o que vocês falam", brief: "Assuntos recorrentes e o \"clima\" da conversa. Sem analisar as brigas: só aponte que há temas sensíveis, se houver." },
  { key: "estilos", fallbackTitle: "Como cada um se comunica", brief: "Como cada um fala: perguntas, humor, emojis, formalidade, áudios. Termine preparando o terreno para a segunda metade, sem antecipar o que ela conclui." },
  { key: "virada", fallbackTitle: "O momento de virada", brief: "O padrão escondido ou o momento de virada da conversa — o que mudou, quando e como." },
  { key: "investimento", fallbackTitle: "Quem está mais investido", brief: "Quem parece mais investido emocionalmente e os sinais concretos disso dos dois lados." },
  { key: "pontos-de-atrito", fallbackTitle: "Os pontos de atrito", brief: "O que gera tensão e como cada um reage." },
  { key: "leitura-final", fallbackTitle: "A leitura final", brief: "Para onde a relação parece estar indo + exatamente 3 conselhos práticos (lista)." },
] as const;

export const MAIN_SECTION_KEYS = MAIN_SECTIONS.map((s) => s.key);

export function mainReportSystemPrompt(): string {
  return `Você escreve o relatório "Psicanalista do Amor": uma leitura, feita por IA, da dinâmica entre duas pessoas a partir da conversa delas.

${INJECTION_RULES}

${TONE_RULES}

ESTRUTURA (8 seções, nesta ordem e com estas "key"):
${MAIN_SECTIONS.map((s, i) => `${i + 1}. "${s.key}" — ${s.brief}`).join("\n")}

As seções 1 a 4 são lidas de graça e precisam entregar valor real (a pessoa precisa sentir que a análise é boa). As seções 5 a 8 devem conter as descobertas MAIS reveladoras e surpreendentes — guarde o melhor para elas.

O QUE AS SEÇÕES 1 A 4 NÃO PODEM ANTECIPAR (é o conteúdo das seções 5 a 8):
- quem está mais ou menos investido, interessado ou envolvido (nem indiretamente: "quem corre atrás", "quem se importa mais");
- o momento de virada ou "o que mudou", com data ou citação;
- a análise dos atritos: o que dispara as brigas e como cada um reage;
- para onde a relação parece estar indo, previsões e conselhos.
Nas seções 1 a 4, descreva o que se vê (hábitos, temas, estilo) e deixe as interpretações dessas quatro perguntas para as seções 5 a 8, sem citar as mesmas mensagens que elas vão usar.

Cada seção tem:
- "title": título real e específico (pode revelar a conclusão).
- "locked_title": título instigante para quando a seção estiver bloqueada. Até 8 palavras, SEM nomes próprios, SEM números/horários/datas e SEM indicar quem é a resposta ou o que se descobriu. Bom: "O dia em que algo mudou entre vocês", "O que muda quando a noite chega". Ruim: "Lucas está se afastando", "Ana investe mais". Nas seções 1 a 4 repita o "title".
- "content": 120 a 250 palavras.
- "evidence": citações que sustentam a seção.

"hook": UMA frase (até 220 caracteres) que fecha a parte grátis, cita uma das pessoas pelo nome e cria curiosidade específica sobre a segunda metade SEM revelar a conclusão. O hook NÃO pode conter números, horários, datas nem citações, nem dizer quem está mais/menos investido ou o que mudou: aponte para ONDE olhar, não para o que se encontrou. Ex.: "Mas há algo no jeito como Lucas volta depois dos silêncios que muda a leitura de tudo isso…"

${SAFETY_RULES}

${FORMAT_RULES}

FORMATO DE SAÍDA:
{
  "schema_version": 1,
  "sections": [
    { "key": "retrato", "title": "...", "locked_title": "...", "content": "...", "evidence": [{ "seq": 12, "quote": "..." }] }
  ],
  "hook": "...",
  "safety_flag": false
}`;
}

/**
 * Regeneração de UMA seção. `written`: seções já escritas (key + título), para a nova
 * não repetir o que elas dizem — nunca o conteúdo delas (economia e sem eco).
 */
export function sectionRegenPrompt(key: string, written: { key: string; title: string }[] = []): string {
  const idx = MAIN_SECTIONS.findIndex((x) => x.key === key);
  const s = MAIN_SECTIONS[idx];
  const done = written.filter((w) => w.key !== key);
  const already = done.length
    ? `\nJá escritas (não repita o que elas tratam): ${done.map((w) => `"${w.key}" (${w.title.replace(/\s+/g, " ").trim().slice(0, 120)})`).join("; ")}.`
    : "";
  const free = idx >= 0 && idx < Math.ceil(MAIN_SECTIONS.length / 2)
    ? " Esta seção é gratuita: não antecipe as conclusões das seções 5 a 8."
    : "";
  return `Gere SOMENTE a seção "${key}" do relatório (${s?.brief ?? ""}).${free}${already} Responda com {"section": {"key": "${key}", "title": "...", "locked_title": "...", "content": "...", "evidence": []}}.`;
}

/** `lockedTitles`: títulos (já neutros) das seções 5 a 8 — nunca o conteúdo delas. */
export function hookOnlyPrompt(lockedTitles: string[] = []): string {
  const topics = lockedTitles.length ? ` A segunda metade fala de: ${lockedTitles.map((t) => `"${t}"`).join(", ")}.` : "";
  return `Escreva SOMENTE o "hook": uma frase (até 220 caracteres) que fecha a parte grátis do relatório, cita uma das pessoas pelo nome e cria curiosidade sobre a segunda metade sem revelar a conclusão, sem números, horários, datas ou citações.${topics} Responda com {"hook": "..."}.`;
}
