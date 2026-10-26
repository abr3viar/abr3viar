import "server-only";
import { and, eq } from "drizzle-orm";
import { encryptField } from "@/server/crypto";
import { getDb } from "@/server/db/client";
import { conversations, funnelEvents, reports, reportTypes } from "@/server/db/schema";
import { log, safeErr, SafeError } from "@/server/log";
import { loadConversationForAi } from "@/server/reports/context";
import { generateMainReport } from "@/server/reports/generate-main";
import { replaceSections } from "@/server/reports/sections";
import { MAIN_REPORT_SLUG } from "@/server/reports/catalog";
import { computeExpiresAt, conversationHasPaidReport } from "@/server/retention";
import { enqueue } from "./boss";
import type { JobHandler } from "./register";

export async function getMainReportType() {
  const [rt] = await getDb().select().from(reportTypes).where(eq(reportTypes.slug, MAIN_REPORT_SLUG));
  if (!rt) throw new SafeError("main_report_type_missing");
  return rt;
}

export const handleGenerateMain: JobHandler<"generate_main"> = async (job, { isFinalAttempt }) => {
  const { conversationId } = job.data;
  const db = getDb();
  const [conv] = await db.select().from(conversations).where(eq(conversations.id, conversationId));
  if (!conv || conv.status !== "generating") return;
  const rt = await getMainReportType();
  const [report] = await db
    .select()
    .from(reports)
    .where(and(eq(reports.conversationId, conversationId), eq(reports.reportTypeId, rt.id)));
  if (!report) throw new SafeError("report_missing");

  const setProgress = async (step: string, current?: number, total?: number) => {
    await db.update(conversations).set({ progress: { step, current, total } }).where(eq(conversations.id, conversationId));
  };

  try {
    await db.update(reports).set({ status: "generating", errorCode: null }).where(eq(reports.id, report.id));
    await setProgress("stats");
    const loaded = await loadConversationForAi(conversationId);
    await db.update(conversations).set({ stats: loaded.stats }).where(eq(conversations.id, conversationId));
    const result = await generateMainReport(loaded, setProgress);
    const paid = await conversationHasPaidReport(conversationId);

    await db.transaction(async (tx) => {
      const freeCount = await replaceSections(tx, report.id, result.sections, "main");
      await tx
        .update(reports)
        .set({
          status: "ready",
          hookText: encryptField(result.hook),
          safetyFlag: result.safetyFlag,
          freeSectionCount: freeCount,
          modelUsed: result.model,
          promptVersion: result.promptVersion,
          tokensIn: result.tokensIn,
          tokensOut: result.tokensOut,
          errorCode: null,
        })
        .where(eq(reports.id, report.id));
      await tx
        .update(conversations)
        .set({
          status: "ready",
          progress: { step: "done" },
          errorCode: null,
          lastAccessedAt: new Date(),
          expiresAt: computeExpiresAt(paid),
        })
        .where(eq(conversations.id, conversationId));
      await tx.insert(funnelEvents).values({ event: "partial_report_ready", sourceType: conv.sourceType });
      if (!report.readyEmailSentAt) {
        await enqueue(
          "send_email",
          { template: "analysis_ready", conversationId },
          { tx, singletonKey: `analysis_ready:${conversationId}` },
        );
        await tx.update(reports).set({ readyEmailSentAt: new Date() }).where(eq(reports.id, report.id));
      }
    });
    log.info(
      { conversationId, reportId: report.id, sections: result.sections.length, safety: result.safetyFlag, tokensIn: result.tokensIn, tokensOut: result.tokensOut },
      "main_report_ready",
    );
  } catch (err) {
    const code = err instanceof SafeError ? err.code : "generation_failed";
    log.warn({ conversationId, code, err: safeErr(err) }, "main_report_error");
    if (isFinalAttempt || code === "no_messages") {
      await db.update(reports).set({ status: "failed", errorCode: code }).where(eq(reports.id, report.id));
      await db
        .update(conversations)
        .set({ status: "failed", errorCode: code, progress: { step: "failed" } })
        .where(eq(conversations.id, conversationId));
      return;
    }
    throw err;
  }
};
