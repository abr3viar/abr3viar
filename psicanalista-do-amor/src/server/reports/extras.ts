import "server-only";
import { and, asc, eq } from "drizzle-orm";
import type { ExtraOfferView } from "@/lib/views";
import { getDb } from "@/server/db/client";
import { reportTypes, reports } from "@/server/db/schema";
import { paymentLinkFor } from "./get-report-view";

/** Vitrine de adicionais para uma conversa (sem conteúdo; só estado e preço). */
export async function listExtraOffers(conversationId: string, userIs: "a" | "b" | "none"): Promise<ExtraOfferView[]> {
  const db = getDb();
  const types = await db
    .select()
    .from(reportTypes)
    .where(and(eq(reportTypes.kind, "extra"), eq(reportTypes.isActive, true)))
    .orderBy(asc(reportTypes.sortOrder));
  const existing = await db.select().from(reports).where(eq(reports.conversationId, conversationId));
  const byType = new Map(existing.map((r) => [r.reportTypeId, r]));
  return types.map((rt) => {
    const r = byType.get(rt.id);
    const state: ExtraOfferView["state"] = !r
      ? "available"
      : r.isUnlocked
        ? r.status === "pending_payment"
          ? "queued"
          : r.status
        : "available";
    return {
      slug: rt.slug,
      name: rt.name,
      teaser: rt.teaser,
      description: rt.description,
      priceCents: rt.priceCents,
      currency: rt.currency,
      purchasable: paymentLinkFor(rt) !== null,
      state,
      reportId: r?.id ?? null,
      blockedReason: rt.requiresUserSide && userIs === "none" ? "needs_user_side" : null,
    };
  });
}
