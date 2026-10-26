import "server-only";
import { and, asc, desc, eq, gt, isNotNull, sql } from "drizzle-orm";
import { requireAdmin } from "@/server/auth/admin";
import { getDb } from "@/server/db/client";
import { conversations, funnelEvents, purchases, reportTypes, reports, stripeEvents, subscriptions, users } from "@/server/db/schema";

/**
 * Consultas do painel /admin. Só números, status e IDs — nada de conteúdo de conversas.
 * Cada função confere o admin por conta própria: o layout NÃO protege as páginas
 * (o Next pode renderizar só o segmento da página numa navegação RSC).
 */

export async function adminOverview() {
  await requireAdmin();
  const db = getDb();
  const since = new Date(Date.now() - 30 * 86_400_000);
  const byStatus = await db
    .select({ status: conversations.status, n: sql<number>`count(*)::int` })
    .from(conversations)
    .groupBy(conversations.status);
  const funnel = await db
    .select({ event: funnelEvents.event, n: sql<number>`count(*)::int` })
    .from(funnelEvents)
    .where(gt(funnelEvents.createdAt, since))
    .groupBy(funnelEvents.event);
  const [revenue] = await db
    .select({ cents: sql<number>`coalesce(sum(coalesce(${purchases.amountPaidCents}, ${purchases.amountCents})), 0)::int`, n: sql<number>`count(*)::int` })
    .from(purchases)
    .where(and(eq(purchases.status, "paid"), gt(purchases.paidAt, since)));
  const webhookErrors = await db
    .select()
    .from(stripeEvents)
    .where(isNotNull(stripeEvents.error))
    .orderBy(desc(stripeEvents.receivedAt))
    .limit(20);
  const types = await db.select().from(reportTypes).orderBy(reportTypes.sortOrder);
  // Assinaturas (D96) por status no Stripe; "revogada" = cobrança reembolsada.
  const subs = await db
    .select({ status: sql<string>`CASE WHEN ${subscriptions.revokedAt} IS NOT NULL THEN 'revogada' ELSE ${subscriptions.status} END`, n: sql<number>`count(*)::int` })
    .from(subscriptions)
    .where(sql`${subscriptions.userId} IS NOT NULL`)
    .groupBy(sql`1`);
  return { byStatus, funnel, revenue: revenue ?? { cents: 0, n: 0 }, webhookErrors, types, subs };
}

export async function adminPurchases() {
  await requireAdmin();
  return getDb()
    .select({
      id: purchases.id,
      createdAt: purchases.createdAt,
      paidAt: purchases.paidAt,
      status: purchases.status,
      amountCents: purchases.amountCents,
      amountPaidCents: purchases.amountPaidCents,
      livemode: purchases.livemode,
      method: purchases.paymentMethodType,
      sessionId: purchases.stripeCheckoutSessionId,
      slug: reportTypes.slug,
      email: users.email,
    })
    .from(purchases)
    .innerJoin(reportTypes, eq(reportTypes.id, purchases.reportTypeId))
    .leftJoin(users, eq(users.id, purchases.userId))
    .orderBy(desc(purchases.createdAt))
    .limit(200);
}

export async function adminFailures() {
  await requireAdmin();
  const db = getDb();
  const failedConversations = await db
    .select({ id: conversations.id, errorCode: conversations.errorCode, updatedAt: conversations.updatedAt, sourceType: conversations.sourceType })
    .from(conversations)
    .where(eq(conversations.status, "failed"))
    .orderBy(desc(conversations.updatedAt))
    .limit(100);
  const failedReports = await db
    .select({ id: reports.id, errorCode: reports.errorCode, updatedAt: reports.updatedAt, slug: reportTypes.slug, isUnlocked: reports.isUnlocked })
    .from(reports)
    .innerJoin(reportTypes, eq(reportTypes.id, reports.reportTypeId))
    .where(and(eq(reports.status, "failed"), eq(reportTypes.kind, "extra")))
    .orderBy(desc(reports.updatedAt))
    .limit(100);
  return { failedConversations, failedReports };
}

export async function adminReportTypes() {
  await requireAdmin();
  return getDb().select().from(reportTypes).orderBy(asc(reportTypes.sortOrder));
}
