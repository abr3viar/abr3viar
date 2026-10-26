import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { isStripeLiveMode } from "@/env";
import type { Evidence, ReportView, SectionView, VerdictView } from "@/lib/views";
import { canAccess, isUuid } from "@/server/access";
import type { Viewer } from "@/server/auth/session";
import { decryptField, decryptJson, decryptLegacyField, decryptNullable } from "@/server/crypto";
import { getDb } from "@/server/db/client";
import {
  conversations,
  reportSections,
  reportTypes,
  reports,
  type Conversation,
  type Report,
  type ReportSection,
  type ReportType,
} from "@/server/db/schema";

/**
 * ÚNICO ponto de leitura de relatórios (plano.md 7; CLAUDE.md, regra 1).
 *
 * - Confere se o `viewer` é dono da conversa; senão retorna null (a página dá 404).
 * - Seção aberta (`report.is_unlocked || section.is_free`): título, conteúdo e evidências decifrados.
 * - Seção bloqueada: SÓ `lockedTitle`, posição e uma faixa de tamanho. Nada do conteúdo,
 *   do título real nem das evidências sai do servidor.
 * - O gancho só é enviado enquanto o relatório está bloqueado.
 */

export function lengthHint(chars: number): "short" | "medium" | "long" {
  if (chars < 700) return "short";
  if (chars < 1400) return "medium";
  return "long";
}

export function paymentLinkFor(rt: ReportType, live = isStripeLiveMode()): { id: string; url: string } | null {
  const id = live ? rt.stripePaymentLinkId : rt.stripeTestPaymentLinkId;
  const url = live ? rt.stripePaymentLinkUrl : rt.stripeTestPaymentLinkUrl;
  return id && url ? { id, url } : null;
}

type Rows = {
  conversation: Pick<Conversation, "id" | "participantAName" | "participantBName">;
  report: Report;
  reportType: ReportType;
  sections: ReportSection[];
};

/** Monta a view a partir das linhas (função pura; testada sem banco). */
export function buildReportView(rows: Rows, opts: { purchasable: boolean }): ReportView {
  const { conversation, report, reportType, sections } = rows;
  const unlocked = report.isUnlocked;
  const ready = report.status === "ready";

  const sectionViews: SectionView[] = ready
    ? sections
        .slice()
        .sort((x, y) => x.position - y.position)
        .map((s): SectionView => {
          if (unlocked || s.isFree) {
            return {
              kind: "open",
              position: s.position,
              key: s.key,
              title: decryptField(s.title),
              contentMarkdown: decryptField(s.content),
              evidence: s.evidence ? (decryptJson(s.evidence) as Evidence[]) : [],
              isSafety: s.isSafety,
            };
          }
          // Só o necessário para desenhar o bloqueio. A faixa de tamanho é calculada
          // a partir do texto cifrado (proporcional), nunca do conteúdo.
          return {
            kind: "locked",
            position: s.position,
            lockedTitle: decryptLegacyField(s.lockedTitle),
            lengthHint: lengthHint(Math.floor((s.content.length * 3) / 4)),
          };
        })
    : [];

  let verdict: VerdictView | null = null;
  if (unlocked && ready && report.verdict) {
    const v = decryptJson(report.verdict) as Partial<VerdictView> | null;
    if (v && typeof v.label === "string") {
      verdict = {
        label: v.label,
        score: typeof v.score === "number" ? v.score : null,
        explanation: typeof v.explanation === "string" ? v.explanation : "",
      };
    }
  }

  return {
    reportId: report.id,
    conversationId: conversation.id,
    slug: reportType.slug,
    kind: reportType.kind === "extra" ? "extra" : "main",
    name: reportType.name,
    status: report.status,
    errorCode: report.errorCode,
    isUnlocked: unlocked,
    hook: !unlocked && ready ? decryptNullable(report.hookText) : null,
    participants: {
      a: decryptNullable(conversation.participantAName) ?? "Pessoa A",
      b: decryptNullable(conversation.participantBName) ?? "Pessoa B",
    },
    sections: sectionViews,
    safetyFlag: report.safetyFlag,
    verdict,
    priceCents: reportType.priceCents,
    currency: reportType.currency,
    purchasable: opts.purchasable,
    progress: report.progress ?? null,
  };
}

async function loadRows(where: ReturnType<typeof and>, viewer: Viewer): Promise<Rows | null> {
  const db = getDb();
  const [row] = await db
    .select({ report: reports, reportType: reportTypes, conversation: conversations })
    .from(reports)
    .innerJoin(reportTypes, eq(reportTypes.id, reports.reportTypeId))
    .innerJoin(conversations, eq(conversations.id, reports.conversationId))
    .where(where);
  if (!row) return null;
  if (row.conversation.status === "deleted" || !canAccess(viewer, row.conversation)) return null;
  const sections = await db
    .select()
    .from(reportSections)
    .where(eq(reportSections.reportId, row.report.id))
    .orderBy(asc(reportSections.position));
  return { conversation: row.conversation, report: row.report, reportType: row.reportType, sections };
}

export async function getReportView(reportId: string, viewer: Viewer | null): Promise<ReportView | null> {
  if (!viewer || !isUuid(reportId)) return null;
  const rows = await loadRows(and(eq(reports.id, reportId)), viewer);
  if (!rows) return null;
  return buildReportView(rows, { purchasable: paymentLinkFor(rows.reportType) !== null });
}

/** Mesmo recorte, localizando o relatório pela conversa + slug do tipo. */
export async function getReportViewBySlug(
  conversationId: string,
  slug: string,
  viewer: Viewer | null,
): Promise<ReportView | null> {
  if (!viewer || !isUuid(conversationId) || !/^[a-z0-9-]{1,64}$/.test(slug)) return null;
  const rows = await loadRows(and(eq(reports.conversationId, conversationId), eq(reportTypes.slug, slug)), viewer);
  if (!rows) return null;
  return buildReportView(rows, { purchasable: paymentLinkFor(rows.reportType) !== null });
}
