import "server-only";
import path from "node:path";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { getDb, getPool } from "./client";
import { seedReportTypes } from "./seed";
import { log, safeErr } from "@/server/log";

/** Chave arbitrária e fixa do advisory lock de migração. */
const MIGRATION_LOCK_KEY = 727_001_2026;

/**
 * Aplica as migrations do Drizzle, instala/atualiza o schema do pg-boss e roda o seed
 * idempotente de `report_types`. Protegido por advisory lock: se duas instâncias
 * subirem juntas, a segunda espera a primeira terminar.
 */
export async function runMigrations(options: { migrationsFolder?: string; seed?: boolean } = {}) {
  const migrationsFolder = options.migrationsFolder ?? path.resolve(process.cwd(), "drizzle");
  const client = await getPool().connect();
  const started = Date.now();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
    log.info({ migrationsFolder: path.basename(migrationsFolder) }, "migrations_start");
    await migrate(getDb(), { migrationsFolder });

    const { getBoss, ensureQueues, stopBoss } = await import("@/server/jobs/boss");
    const boss = await getBoss("migrate");
    await ensureQueues(boss);
    await stopBoss();

    if (options.seed !== false) await seedReportTypes();
    await encryptLegacyLockedTitles();
    log.info({ ms: Date.now() - started }, "migrations_done");
  } catch (err) {
    log.error({ err: safeErr(err) }, "migrations_failed");
    throw err;
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]).catch(() => undefined);
    client.release();
  }
}

/**
 * D83: `report_sections.locked_title` passou a ser cifrado. Linhas antigas em texto puro são
 * cifradas aqui, em lotes, a cada inicialização (idempotente: só pega quem não está cifrado).
 */
export async function encryptLegacyLockedTitles(): Promise<number> {
  const { encryptField } = await import("@/server/crypto");
  const { auditLog, reportSections } = await import("./schema");
  const { eq, notLike } = await import("drizzle-orm");
  const db = getDb();
  // Depois da primeira passada completa não há como surgir linha nova em texto puro (toda
  // gravação já cifra): a marca no audit_log evita varrer a tabela a cada inicialização.
  const DONE = "crypto.legacy_locked_titles_done";
  const [done] = await db.select({ id: auditLog.id }).from(auditLog).where(eq(auditLog.action, DONE)).limit(1);
  if (done) return 0;
  let total = 0;
  try {
    for (;;) {
      const rows = await db
        .select({ id: reportSections.id, t: reportSections.lockedTitle })
        .from(reportSections)
        .where(notLike(reportSections.lockedTitle, "v1:%"))
        .limit(500);
      if (rows.length === 0) break;
      for (const r of rows) await db.update(reportSections).set({ lockedTitle: encryptField(r.t) }).where(eq(reportSections.id, r.id));
      total += rows.length;
    }
    await db.insert(auditLog).values({ action: DONE, meta: { total } });
  } catch (err) {
    // Não derruba a subida do site: tenta de novo na próxima inicialização.
    log.error({ err: safeErr(err), total }, "legacy_locked_titles_failed");
    return total;
  }
  if (total) log.info({ total }, "legacy_locked_titles_encrypted");
  return total;
}
