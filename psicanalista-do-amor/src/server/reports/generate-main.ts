import "server-only";
import { getEnv } from "@/env";
import { getAiClient, rejectOutput } from "@/server/ai/client";
import {
  MAIN_SECTIONS,
  MAIN_SECTION_KEYS,
  PROMPT_VERSION,
  hookOnlyPrompt,
  mainReportSystemPrompt,
  sectionRegenPrompt,
} from "@/server/ai/prompts/main-report";
import { hookSchema, mainReportSchema, singleSectionSchema, type AiSection } from "@/server/ai/schemas";
import { SafeError } from "@/server/log";
import { buildAnalysisContext, type LoadedConversation } from "./context";
import { anticipatesPaidConclusion, isRealAlert, isSafeHook, safeLockedTitle } from "./guards";
import {
  DEFAULT_SAFETY_CONTENT,
  SAFETY_SECTION_KEY,
  safetyContent,
  sanitizeEvidence,
  textMessagesBySeq,
  type SectionToSave,
} from "./sections";

export type MainReportResult = {
  sections: SectionToSave[];
  hook: string;
  safetyFlag: boolean;
  model: string;
  promptVersion: string;
  tokensIn: number;
  tokensOut: number;
};

const hasContent = (s: AiSection | undefined): s is AiSection => Boolean(s && s.content.trim().length >= 40);

/**
 * Gera o relatório principal (plano.md 5.5): 8 seções em ordem fixa, gancho e
 * alerta de risco. Seção faltando → regenera só ela (1 tentativa); seção grátis que
 * antecipa conclusão paga → 1 nova tentativa; gancho ruim → chamada curta só para o
 * gancho; citações conferidas contra a mensagem real.
 */
export async function generateMainReport(
  loaded: LoadedConversation,
  onProgress: (step: string, current?: number, total?: number) => Promise<void>,
): Promise<MainReportResult> {
  const env = getEnv();
  const ai = getAiClient();
  const ctx = await buildAnalysisContext(loaded, (c, t) => onProgress("analyzing", c, t));
  let tokensIn = ctx.tokensIn;
  let tokensOut = ctx.tokensOut;
  await onProgress("writing");

  const system = mainReportSystemPrompt();
  const userMsg = `${ctx.text}\n\nEscreva agora o relatório completo em JSON.`;
  const res = await ai.callJson({
    purpose: "report",
    label: "main_report",
    schema: mainReportSchema,
    maxCompletionTokens: env.GROQ_REPORT_MAX_COMPLETION_TOKENS,
    temperature: 0.7,
    messages: [
      { role: "system", content: system },
      { role: "user", content: userMsg },
    ],
    validate: (d) => {
      const present = MAIN_SECTION_KEYS.filter((k) => hasContent(d.sections.find((s) => s.key === k))).length;
      if (present < 5) rejectOutput("missing_sections");
    },
  });
  tokensIn += res.tokensIn;
  tokensOut += res.tokensOut;
  const model = res.model;
  const byKey = new Map(res.data.sections.map((s) => [s.key, s]));

  const half = Math.ceil(MAIN_SECTIONS.length / 2);
  // Títulos já escritos para a regeneração não repetir conteúdo. Ao refazer uma seção GRÁTIS,
  // só os das grátis: os títulos reais das pagas podem revelar a conclusão.
  const written = (forKey: string) => {
    const freeOnly = MAIN_SECTION_KEYS.indexOf(forKey as (typeof MAIN_SECTION_KEYS)[number]) < half;
    return MAIN_SECTION_KEYS.filter((k, i) => (!freeOnly || i < half) && hasContent(byKey.get(k))).map((k) => ({ key: k, title: byKey.get(k)!.title }));
  };
  const regenerate = async (key: string) => {
    const regen = await ai
      .callJson({
        purpose: "report",
        label: "main_report_section",
        schema: singleSectionSchema,
        maxCompletionTokens: 3000,
        temperature: 0.7,
        maxAttempts: 2,
        reasoningEffort: "low",
        messages: [
          { role: "system", content: system },
          { role: "user", content: `${ctx.text}\n\n${sectionRegenPrompt(key, written(key))}` },
        ],
      })
      .catch(() => null);
    if (!regen) return null;
    tokensIn += regen.tokensIn;
    tokensOut += regen.tokensOut;
    const section = regen.data.section ?? undefined;
    return hasContent(section) ? { ...section, key } : null;
  };

  for (const key of MAIN_SECTION_KEYS) {
    if (hasContent(byKey.get(key))) continue;
    const section = await regenerate(key);
    if (section) byKey.set(key, section);
    if (!hasContent(byKey.get(key))) throw new SafeError("ai_missing_section");
  }

  // Seção GRÁTIS que antecipa uma conclusão da segunda metade (quem investe mais, a virada,
  // para onde vai): uma nova tentativa só dela; se a nova também antecipar, fica a original.
  for (const key of MAIN_SECTION_KEYS.slice(0, half)) {
    const current = byKey.get(key)!;
    if (!anticipatesPaidConclusion(`${current.title}\n${current.content}`)) continue;
    const section = await regenerate(key);
    if (section && !anticipatesPaidConclusion(`${section.title}\n${section.content}`)) byKey.set(key, section);
  }

  const names = [loaded.names.a, loaded.names.b];
  // Alerta de risco (D19/D43): liga se a IA marcou a flag, se escreveu a seção "alerta"
  // mesmo sem a flag, ou se alguma nota do map registrou risco (conversas longas).
  const alertSection = byKey.get(SAFETY_SECTION_KEY);
  const safetyFlag = res.data.safety_flag || isRealAlert(alertSection) || ctx.safetyConcerns;

  // Títulos bloqueados conferidos no servidor (sem nomes, sem repetir o título real).
  const lockedTitles = MAIN_SECTIONS.map((def, i) => {
    if (i < half) return def.fallbackTitle;
    const s = byKey.get(def.key)!;
    return safeLockedTitle(s.locked_title, s.title.trim() || def.fallbackTitle, names, def.fallbackTitle);
  });

  let hook = (res.data.hook ?? "").trim();
  if (safetyFlag) {
    // Com alerta de risco, nada de gancho de curiosidade colado ao aviso.
    hook = `O relatório completo traz mais sobre como ${loaded.names.a} e ${loaded.names.b} se relacionam, se fizer sentido para você agora.`;
  } else if (!isSafeHook(hook, names)) {
    const h = await ai
      .callJson({
        purpose: "report",
        label: "main_report_hook",
        schema: hookSchema,
        maxCompletionTokens: 2000,
        temperature: 0.8,
        reasoningEffort: "low",
        messages: [
          { role: "system", content: system },
          { role: "user", content: `${ctx.text}\n\n${hookOnlyPrompt(lockedTitles.slice(half))}` },
        ],
      })
      .catch(() => null);
    if (h) {
      tokensIn += h.tokensIn;
      tokensOut += h.tokensOut;
      hook = (h.data.hook ?? "").trim();
    }
    if (!isSafeHook(hook, names)) {
      hook = `Mas tem uma coisa no jeito como ${loaded.names.b} e ${loaded.names.a} lidam um com o outro que muda a leitura de tudo isso…`;
    }
  }
  if (hook.length > 300) hook = `${hook.slice(0, 299)}…`;

  const bySeq = textMessagesBySeq(loaded.messages);
  const sections: SectionToSave[] = MAIN_SECTIONS.map((def, i) => {
    const s = byKey.get(def.key)!;
    const title = s.title.trim() || def.fallbackTitle;
    return {
      key: def.key,
      title: title.slice(0, 160),
      lockedTitle: lockedTitles[i]!.slice(0, 160),
      content: s.content.trim(),
      evidence: sanitizeEvidence(s.evidence, bySeq),
      isSafety: false,
    };
  });

  if (safetyFlag) {
    sections.unshift({
      key: SAFETY_SECTION_KEY,
      title: "Um cuidado importante",
      lockedTitle: "Um cuidado importante",
      content: hasContent(alertSection) ? safetyContent(alertSection.content) : DEFAULT_SAFETY_CONTENT,
      evidence: hasContent(alertSection) ? sanitizeEvidence(alertSection.evidence, bySeq) : [],
      isSafety: true,
    });
  }

  return { sections, hook, safetyFlag, model, promptVersion: PROMPT_VERSION, tokensIn, tokensOut };
}
