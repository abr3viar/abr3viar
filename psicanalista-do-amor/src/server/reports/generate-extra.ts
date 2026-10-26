import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { getEnv } from "@/env";
import { getAiClient, rejectOutput } from "@/server/ai/client";
import {
  ADVICE_SECTION_KEY,
  PROMPT_VERSION,
  deliveredReadingBlock,
  expectedKeys,
  extraSectionRegenPrompt,
  extraSystemPrompt,
  fillTemplate,
  interestVerdictLabel,
  type DeliveredReading,
} from "@/server/ai/prompts/extra-report";
import { extraReportSchema, singleSectionSchema, type AiSection } from "@/server/ai/schemas";
import { decryptField } from "@/server/crypto";
import { getDb } from "@/server/db/client";
import { reportSections, reportTypes, reports, type ReportType } from "@/server/db/schema";
import { SafeError } from "@/server/log";
import { isRealAlert } from "./guards";
import { buildAnalysisContext, sanitizeName, type LoadedConversation } from "./context";
import {
  DEFAULT_SAFETY_CONTENT,
  SAFETY_SECTION_KEY,
  safetyContent,
  sanitizeEvidence,
  textMessagesBySeq,
  type SectionToSave,
} from "./sections";

export type ExtraReportResult = {
  sections: SectionToSave[];
  verdict: { label: string; score: number | null; explanation: string } | null;
  safetyFlag: boolean;
  model: string;
  promptVersion: string;
  tokensIn: number;
  tokensOut: number;
};

const hasContent = (s: AiSection | undefined): s is AiSection => Boolean(s && s.content.trim().length >= 40);

/** Teto de saída de um adicional (4–5 seções curtas): menos que o principal (IA-6). */
export const EXTRA_MAX_COMPLETION_TOKENS = 7000;

/**
 * Títulos reais do relatório principal desta conversa, SÓ se ele já foi liberado pelo
 * webhook (o adicional só é gerado depois disso — D60). Sem o conteúdo das seções.
 */
export async function loadDeliveredReading(conversationId: string): Promise<DeliveredReading | null> {
  const db = getDb();
  const [main] = await db
    .select({ id: reports.id, name: reportTypes.name })
    .from(reports)
    .innerJoin(reportTypes, eq(reportTypes.id, reports.reportTypeId))
    .where(
      and(
        eq(reports.conversationId, conversationId),
        eq(reportTypes.kind, "main"),
        eq(reports.isUnlocked, true),
        eq(reports.status, "ready"),
      ),
    );
  if (!main) return null;
  const rows = await db
    .select({ title: reportSections.title, isSafety: reportSections.isSafety })
    .from(reportSections)
    .where(eq(reportSections.reportId, main.id))
    .orderBy(asc(reportSections.position));
  const titles = rows.filter((r) => !r.isSafety).map((r) => decryptField(r.title));
  return titles.length ? { label: main.name, titles } : null;
}

/** Relatório adicional: system comum + prompt_template + contexto (stats + conversa ou notas). */
export async function generateExtraReport(
  loaded: LoadedConversation,
  rt: ReportType,
  onProgress: (step: string, current?: number, total?: number) => Promise<void>,
  delivered: DeliveredReading | null = null,
): Promise<ExtraReportResult> {
  if (rt.requiresUserSide && loaded.userIs === "none") throw new SafeError("needs_user_side");
  const ai = getAiClient();
  const ctx = await buildAnalysisContext(loaded, (c, t) => onProgress("analyzing", c, t));
  let tokensIn = ctx.tokensIn;
  let tokensOut = ctx.tokensOut;
  await onProgress("writing");
  const names = { a: sanitizeName(loaded.names.a, "Pessoa A"), b: sanitizeName(loaded.names.b, "Pessoa B") };
  const template = fillTemplate(rt.promptTemplate, names, loaded.userIs);
  const keys = expectedKeys(template);
  const system = extraSystemPrompt({ name: rt.name, template, slug: rt.slug });
  const deliveredBlock = deliveredReadingBlock(delivered);
  const context = deliveredBlock ? `${ctx.text}\n\n${deliveredBlock}` : ctx.text;

  const res = await ai.callJson({
    purpose: "report",
    label: `extra_${rt.slug}`,
    schema: extraReportSchema,
    maxCompletionTokens: Math.min(getEnv().GROQ_REPORT_MAX_COMPLETION_TOKENS, EXTRA_MAX_COMPLETION_TOKENS),
    temperature: 0.7,
    messages: [
      { role: "system", content: system },
      { role: "user", content: `${context}\n\nEscreva agora o relatório "${rt.name}" em JSON.` },
    ],
    validate: (d) => {
      const ok = d.sections.filter((s) => s.key !== SAFETY_SECTION_KEY && hasContent(s));
      const needed = keys.length ? Math.ceil(keys.length * 0.75) : 2;
      if (ok.length < needed) rejectOutput("missing_sections");
    },
  });
  tokensIn += res.tokensIn;
  tokensOut += res.tokensOut;

  const bySeq = textMessagesBySeq(loaded.messages);
  const regular = res.data.sections.filter((s) => s.key !== SAFETY_SECTION_KEY && hasContent(s));

  // A seção de conselhos é a mais acionável: se faltou, regenera só ela (1 chamada curta).
  const adviceKey = ADVICE_SECTION_KEY[rt.slug];
  if (adviceKey && keys.includes(adviceKey) && !regular.some((s) => s.key === adviceKey)) {
    const written = regular.map((s) => ({ key: s.key, title: s.title }));
    const regen = await ai
      .callJson({
        purpose: "report",
        label: `extra_${rt.slug}_section`,
        schema: singleSectionSchema,
        maxCompletionTokens: 3000,
        temperature: 0.7,
        maxAttempts: 2,
        reasoningEffort: "low",
        messages: [
          { role: "system", content: system },
          { role: "user", content: `${context}\n\n${extraSectionRegenPrompt(adviceKey, template, written)}` },
        ],
      })
      .catch(() => null);
    if (regen) {
      tokensIn += regen.tokensIn;
      tokensOut += regen.tokensOut;
      const section = regen.data.section ?? undefined;
      if (hasContent(section)) regular.push({ ...section, key: adviceKey });
    }
  }

  // Ordem pedida no template; seções extras (não pedidas) vão ao fim.
  regular.sort((x, y) => {
    const ix = keys.indexOf(x.key);
    const iy = keys.indexOf(y.key);
    return (ix < 0 ? 99 : ix) - (iy < 0 ? 99 : iy);
  });
  const sections: SectionToSave[] = regular.map((s) => ({
    key: s.key.slice(0, 64),
    title: (s.title.trim() || rt.name).slice(0, 160),
    lockedTitle: "Seção do relatório adicional",
    content: s.content.trim(),
    evidence: sanitizeEvidence(s.evidence, bySeq),
    isSafety: false,
  }));
  const alert = res.data.sections.find((s) => s.key === SAFETY_SECTION_KEY);
  // Liga o alerta também quando a IA escreveu a seção sem marcar a flag, ou o map achou risco.
  const safetyFlag = res.data.safety_flag || isRealAlert(alert) || ctx.safetyConcerns;
  if (safetyFlag) {
    sections.unshift({
      key: SAFETY_SECTION_KEY,
      title: "Um cuidado importante",
      lockedTitle: "Um cuidado importante",
      content: hasContent(alert) ? safetyContent(alert.content) : DEFAULT_SAFETY_CONTENT,
      evidence: hasContent(alert) ? sanitizeEvidence(alert.evidence, bySeq) : [],
      isSafety: true,
    });
  }

  const v = res.data.verdict;
  let verdict = v && v.label.trim()
    ? { label: v.label.trim().slice(0, 120), score: v.score === null ? null : Math.round(v.score), explanation: v.explanation.trim().slice(0, 600) }
    : null;
  // "Quem demonstra mais interesse?": o nome no placar vem do score, não do texto da IA
  // (a IA às vezes inverte A e B ou dá 64% com o rótulo "equilibrado").
  if (verdict && verdict.score !== null && rt.slug === "quem-gosta-mais") {
    verdict = { ...verdict, label: interestVerdictLabel(verdict.score, names) };
  }
  return {
    sections,
    verdict,
    safetyFlag,
    model: res.model,
    promptVersion: PROMPT_VERSION,
    tokensIn,
    tokensOut,
  };
}
