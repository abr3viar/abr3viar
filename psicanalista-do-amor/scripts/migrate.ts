import "./load-env";
import { runMigrations } from "@/server/db/migrate";
import { closeDb } from "@/server/db/client";
import { safeErr } from "@/server/log";

runMigrations({ migrationsFolder: process.env.MIGRATIONS_DIR })
  .then(async () => {
    await closeDb();
    process.exit(0);
  })
  .catch(async (err: unknown) => {
    // Mostra o MOTIVO sem valores sensíveis: nomes de variáveis inválidas (EnvError) ou o
    // código do erro (ECONNREFUSED, 28P01 = senha errada, DEPTH_ZERO_SELF_SIGNED_CERT...).
    console.error(`[migrate] ${describeError(err)}`);
    await closeDb().catch(() => undefined);
    process.exit(1);
  });

function describeError(err: unknown): string {
  const e = safeErr(err);
  if (e.name === "EnvError" && e.message) return String(e.message);
  return [e.name, e.code && `código ${e.code}`].filter(Boolean).join(" — ");
}
