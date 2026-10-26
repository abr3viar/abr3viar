import "server-only";
import { and, desc, eq, gt } from "drizzle-orm";
import { canAccess } from "@/server/access";
import type { Viewer } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { conversations, purchases, reportTypes, reports } from "@/server/db/schema";

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Compra a acompanhar na página de retorno (últimas 24 h, pela SESSÃO — a URL nunca libera
 * nada). Ordena pela última atividade (`updated_at`: criada, reaproveitada ou paga), e o
 * `?link=<slug>` do redirect do Payment Link só escolhe ENTRE as compras do próprio usuário.
 */
export async function findLatestPurchaseForUser(viewer: Viewer, slug?: string | null) {
  const rows = await getDb()
    .select({
      purchaseId: purchases.id,
      reportId: reports.id,
      conversationId: reports.conversationId,
      slug: reportTypes.slug,
      conversation: { userId: conversations.userId, createdBySessionId: conversations.createdBySessionId },
    })
    .from(purchases)
    .innerJoin(reports, eq(reports.id, purchases.reportId))
    .innerJoin(conversations, eq(conversations.id, reports.conversationId))
    .innerJoin(reportTypes, eq(reportTypes.id, purchases.reportTypeId))
    .where(
      and(
        eq(purchases.userId, viewer.userId),
        gt(purchases.updatedAt, new Date(Date.now() - 86_400_000)),
        ...(slug && SLUG.test(slug) ? [eq(reportTypes.slug, slug)] : []),
      ),
    )
    .orderBy(desc(purchases.updatedAt))
    .limit(20);
  const found = rows.find((r) => canAccess(viewer, r.conversation));
  if (!found) return null;
  const { conversation: _c, ...rest } = found;
  void _c;
  return rest;
}
