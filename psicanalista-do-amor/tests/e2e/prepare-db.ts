import { sql } from "drizzle-orm";
import { closeDb, getDb } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";

async function main() {
  await runMigrations();
  const db = getDb();
  await db.execute(sql`
    TRUNCATE users, sessions, login_tokens, consents, conversations, conversation_files,
      messages, conversation_digests, reports, report_sections, purchases,
      stripe_events, rate_limits, ai_rate_state, audit_log, funnel_events, subscriptions, subscription_unlocks, access_logs CASCADE
  `);
  await db.execute(sql`DELETE FROM pgboss.job`);
  // Payment Links de TESTE apontando para o "Stripe" falso do servidor de mocks.
  const mock = `http://localhost:${process.env.E2E_MOCK_PORT ?? "3999"}`;
  await db.execute(sql`
    UPDATE report_types
       SET stripe_test_payment_link_id = 'plink_e2e_' || replace(slug, '-', '_'),
           stripe_test_payment_link_url = ${mock} || '/stripe/pay/' || slug
  `);
  await closeDb();
}

main().then(
  () => process.exit(0),
  (err: unknown) => {
    console.error(err);
    process.exit(1);
  },
);
