import { sql } from "drizzle-orm";
import { describe } from "vitest";
import { getDb } from "@/server/db/client";

export const hasTestDb = Boolean(process.env.TEST_DATABASE_URL);

/** `describe` que é pulado (com aviso no global-setup) quando não há banco de teste. */
export const describeDb = hasTestDb ? describe : describe.skip;

let migrated = false;

export async function prepareTestDb(): Promise<void> {
  if (!migrated) {
    const { runMigrations } = await import("@/server/db/migrate");
    await runMigrations();
    migrated = true;
  }
  await truncateAll();
  const { seedReportTypes } = await import("@/server/db/seed");
  await seedReportTypes();
}

export async function truncateAll(): Promise<void> {
  await getDb().execute(sql`
    TRUNCATE users, sessions, login_tokens, consents, conversations, conversation_files,
      messages, conversation_digests, report_types, reports, report_sections, purchases,
      stripe_events, rate_limits, ai_rate_state, audit_log, funnel_events, subscriptions, subscription_unlocks, access_logs CASCADE
  `);
  await getDb().execute(sql`DELETE FROM pgboss.job`);
}
