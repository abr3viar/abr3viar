import "server-only";
import { eq } from "drizzle-orm";
import { encryptJson } from "@/server/crypto";
import { getDb } from "@/server/db/client";
import { funnelEvents, reportTypes, reports } from "@/server/db/schema";
import { log, safeErr, SafeError } from "@/server/log";
import { loadConversationForAi } from "@/server/reports/context";
import { generateExtraReport, loadDeliveredReading } from "@/server/reports/generate-extra";
import { replaceSections } from "@/server/reports/sections";
import { enqueue } from "./boss";
import type { JobHandler } from "./register";

export const handleGenerateExtra: JobHandler<"generate_extra"> = async (job, { isFinalAttempt }) => {
  const { reportId } = job.data;
  const db = getDb();
  const [row] = await db
    .select({ report: reports, rt: reportTypes })
    .from(reports)
    .innerJoin(reportTypes, eq(reportTypes.id, reports.reportTypeId))
    .where(eq(reports.id, reportId));
  if (!row) return;
  const { report, rt } = row;
  // Adicionais só são gerados DEPOIS do pagamento confirmado pelo webhook (D7).
  if (!report.isUnlocked || rt.kind !== "extra" || report.status === "ready") return;

  const setProgress = async (step: string, current?: number, total?: number) => {
    await db.update(reports).set({ progress: { step, current, total } }).where(eq(reports.id, reportId));
  };

  try {
    await db.update(reports).set({ status: "generating", errorCode: null, progress: { step: "stats" } }).where(eq(reports.id, reportId));
    const loaded = await loadConversationForAi(report.conversationId);
    // Títulos do principal já liberado (D60), para o adicional não repetir a leitura.
    const delivered = await loadDeliveredReading(report.conversationId);
    const result = await generateExtraReport(loaded, rt, setProgress, delivered);
    await db.transaction(async (tx) => {
      await replaceSections(tx, reportId, result.sections, "extra");
      await tx
        .update(reports)
        .set({
          status: "ready",
          progress: { step: "done" },
          verdict: result.verdict ? encryptJson(result.verdict) : null,
          safetyFlag: result.safetyFlag,
          modelUsed: result.model,
          promptVersion: result.promptVersion,
          tokensIn: result.tokensIn,
          tokensOut: result.tokensOut,
          errorCode: null,
        })
        .where(eq(reports.id, reportId));
      await tx.insert(funnelEvents).values({ event: "extra_report_ready", reportTypeSlug: rt.slug });
      await enqueue("send_email", { template: "extra_ready", reportId }, { tx, singletonKey: `extra_ready:${reportId}` });
    });
    log.info({ reportId, slug: rt.slug, sections: result.sections.length }, "extra_report_ready");
  } catch (err) {
    const code = err instanceof SafeError ? err.code : "generation_failed";
    log.warn({ reportId, code, err: safeErr(err) }, "extra_report_error");
    if (isFinalAttempt || code === "needs_user_side") {
      await db.update(reports).set({ status: "failed", errorCode: code, progress: { step: "failed" } }).where(eq(reports.id, reportId));
      return;
    }
    throw err;
  }
};
