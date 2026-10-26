import { eq } from "drizzle-orm";
import { canAccess, isUuid } from "@/server/access";
import { getViewer } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { conversations, reports } from "@/server/db/schema";
import { jsonError, noStoreHeaders } from "@/server/http";

export const dynamic = "force-dynamic";

/** Status de geração de um relatório (polling). Sem conteúdo. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const viewer = await getViewer();
  if (!viewer || !isUuid(id)) return jsonError("not_found", 404);
  const [row] = await getDb()
    .select({ report: reports, conversation: conversations })
    .from(reports)
    .innerJoin(conversations, eq(conversations.id, reports.conversationId))
    .where(eq(reports.id, id));
  if (!row || row.conversation.status === "deleted" || !canAccess(viewer, row.conversation)) return jsonError("not_found", 404);
  return Response.json(
    { status: row.report.status, progress: row.report.progress ?? null, errorCode: row.report.errorCode },
    { headers: noStoreHeaders() },
  );
}
