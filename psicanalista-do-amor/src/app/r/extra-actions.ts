"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getOwnedConversation } from "@/server/access";
import { getViewer } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { conversations, reportTypes, reports } from "@/server/db/schema";
import { enqueue } from "@/server/jobs/boss";
import { consumeRateLimit } from "@/server/rate-limit";

/** Reprocessa um adicional JÁ PAGO que falhou (sem nova cobrança). */
export async function retryExtraAction(form: FormData): Promise<void> {
  const reportId = String(form.get("reportId") ?? "");
  const viewer = await getViewer();
  if (!viewer || !z.uuid().safeParse(reportId).success) redirect("/minhas-analises");
  const db = getDb();
  const [row] = await db
    .select({ report: reports, slug: reportTypes.slug })
    .from(reports)
    .innerJoin(reportTypes, eq(reportTypes.id, reports.reportTypeId))
    .where(eq(reports.id, reportId));
  const conv = row ? await getOwnedConversation(row.report.conversationId, viewer) : null;
  if (!row || !conv) redirect("/minhas-analises");
  const target = `/r/${conv.id}/extra/${row.slug}`;
  if (!row.report.isUnlocked || row.report.status !== "failed") redirect(target);
  if (!(await consumeRateLimit("reprocess", [`user:${viewer.userId}`]))) redirect(target);
  await db.transaction(async (tx) => {
    await tx.update(reports).set({ status: "queued", errorCode: null, progress: { step: "queued" } }).where(and(eq(reports.id, reportId), eq(reports.status, "failed")));
    await enqueue("generate_extra", { reportId }, { tx, singletonKey: reportId });
  });
  redirect(target);
}

/** Define quem é o usuário depois da confirmação (libera "Como responder"). */
export async function setUserSideAction(form: FormData): Promise<void> {
  const conversationId = String(form.get("conversationId") ?? "");
  const userIs = z.enum(["a", "b"]).safeParse(form.get("userIs"));
  const conv = await getOwnedConversation(conversationId, await getViewer());
  if (!conv) redirect("/minhas-analises");
  if (userIs.success) {
    await getDb().update(conversations).set({ userIs: userIs.data }).where(eq(conversations.id, conv.id));
  }
  // Sem isto, o redirect para a mesma URL (só muda a âncora) reaproveita a vitrine antiga (QA-06).
  revalidatePath(`/r/${conv.id}`);
  redirect(`/r/${conv.id}?lado=ok#extras`);
}
