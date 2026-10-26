import { and, desc, eq } from "drizzle-orm";
import { getViewer } from "@/server/auth/session";
import { canAccess, isUuid } from "@/server/access";
import { getDb } from "@/server/db/client";
import { conversations, purchases, reportTypes, reports } from "@/server/db/schema";
import { jsonError, noStoreHeaders } from "@/server/http";

export const dynamic = "force-dynamic";

/**
 * Status da compra mais recente de um relatório do usuário logado (polling da página
 * de retorno). Só lê; nunca libera nada.
 */
export async function GET(req: Request) {
  const viewer = await getViewer();
  const reportId = new URL(req.url).searchParams.get("report");
  if (!viewer || !isUuid(reportId)) return jsonError("not_found", 404);
  const db = getDb();
  const [row] = await db
    .select({ report: reports, conversation: conversations, slug: reportTypes.slug, kind: reportTypes.kind })
    .from(reports)
    .innerJoin(conversations, eq(conversations.id, reports.conversationId))
    .innerJoin(reportTypes, eq(reportTypes.id, reports.reportTypeId))
    .where(eq(reports.id, reportId));
  if (!row || row.conversation.status === "deleted" || !canAccess(viewer, row.conversation)) {
    return jsonError("not_found", 404);
  }
  const [purchase] = await db
    .select({ status: purchases.status })
    .from(purchases)
    .where(and(eq(purchases.reportId, reportId), eq(purchases.userId, viewer.userId)))
    .orderBy(desc(purchases.updatedAt))
    .limit(1);
  const target = row.kind === "main" ? `/r/${row.conversation.id}` : `/r/${row.conversation.id}/extra/${row.slug}`;
  return Response.json(
    { purchaseStatus: purchase?.status ?? null, unlocked: row.report.isUnlocked, target },
    { headers: noStoreHeaders() },
  );
}
