import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import { decryptField, decryptJson, decryptNullable } from "@/server/crypto";
import { getDb } from "@/server/db/client";
import {
  accessLogs,
  consents,
  conversations,
  messages,
  purchases,
  reportSections,
  reportTypes,
  reports,
  subscriptionUnlocks,
  subscriptions,
  users,
} from "@/server/db/schema";

/** Exportação dos dados do titular (LGPD), decifrados, em JSON. */
export async function exportUserData(userId: string) {
  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) return null;
  const convs = await db.select().from(conversations).where(eq(conversations.userId, userId)).orderBy(asc(conversations.createdAt));
  const convIds = convs.map((c) => c.id);
  const msgs = convIds.length
    ? await db.select().from(messages).where(inArray(messages.conversationId, convIds)).orderBy(asc(messages.seq))
    : [];
  const reps = convIds.length
    ? await db
        .select({ report: reports, slug: reportTypes.slug, name: reportTypes.name })
        .from(reports)
        .innerJoin(reportTypes, eq(reportTypes.id, reports.reportTypeId))
        .where(inArray(reports.conversationId, convIds))
    : [];
  const secs = reps.length
    ? await db.select().from(reportSections).where(inArray(reportSections.reportId, reps.map((r) => r.report.id))).orderBy(asc(reportSections.position))
    : [];
  const userConsents = await db.select().from(consents).where(eq(consents.userId, userId));
  const userPurchases = await db.select().from(purchases).where(and(eq(purchases.userId, userId)));
  const userSubs = await db.select().from(subscriptions).where(eq(subscriptions.userId, userId));
  const userSubUnlocks = await db.select().from(subscriptionUnlocks).where(eq(subscriptionUnlocks.userId, userId));
  const userAccess = await db.select().from(accessLogs).where(eq(accessLogs.userId, userId)).orderBy(asc(accessLogs.occurredAt));

  return {
    exportedAt: new Date().toISOString(),
    user: { email: user.email, createdAt: user.createdAt, emailVerifiedAt: user.emailVerifiedAt },
    consents: userConsents.map((c) => ({ kind: c.kind, version: c.version, acceptedAt: c.acceptedAt, conversationId: c.conversationId })),
    purchases: userPurchases.map((p) => ({ id: p.id, status: p.status, amountCents: p.amountCents, currency: p.currency, createdAt: p.createdAt, paidAt: p.paidAt })),
    subscriptions: userSubs.map((s) => ({
      status: s.revokedAt ? "revoked" : s.status,
      currentPeriodEnd: s.currentPeriodEnd,
      cancelAtPeriodEnd: s.cancelAtPeriodEnd,
      createdAt: s.createdAt,
    })),
    subscriptionUsage: userSubUnlocks.map((u) => ({ day: u.day, reportId: u.reportId, countsTowardDailyLimit: u.counts })),
    // Registros de acesso (Marco Civil, art. 15): os do próprio titular.
    accessLogs: userAccess.map((a) => ({ event: a.event, ip: decryptField(a.ip), occurredAt: a.occurredAt })),
    conversations: convs.map((c) => ({
      id: c.id,
      createdAt: c.createdAt,
      status: c.status,
      sourceType: c.sourceType,
      participants: { a: decryptNullable(c.participantAName), b: decryptNullable(c.participantBName), youAre: c.userIs },
      expiresAt: c.expiresAt,
      stats: c.stats,
      messages: msgs
        .filter((m) => m.conversationId === c.id)
        .map((m) => ({ seq: m.seq, sender: m.sender, senderName: decryptNullable(m.senderRaw), sentAt: m.sentAt, kind: m.kind, content: decryptField(m.content) })),
      reports: reps
        .filter((r) => r.report.conversationId === c.id && r.report.isUnlocked)
        .map((r) => ({
          type: r.name,
          status: r.report.status,
          verdict: r.report.verdict ? decryptJson(r.report.verdict) : null,
          sections: secs
            .filter((s) => s.reportId === r.report.id)
            .map((s) => ({ title: decryptField(s.title), content: decryptField(s.content) })),
        })),
    })),
  };
}
