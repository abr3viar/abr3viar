/**
 * Processo worker (pg-boss): ingestão, OCR, geração de relatórios, e-mails e limpezas.
 * Em dev: `npm run worker`. Em produção: `node dist/worker.mjs` (ver Dockerfile).
 */
import "../scripts/load-env";
import { getEnv } from "@/env";
import { getBoss, stopBoss } from "@/server/jobs/boss";
import { registerHandlers } from "@/server/jobs/register";
import { closeDb } from "@/server/db/client";
import { log, safeErr } from "@/server/log";

async function main(): Promise<void> {
  process.env.PROCESS_ROLE ??= "worker";
  getEnv(); // falha cedo se faltar variável
  const boss = await getBoss("worker");
  await registerHandlers(boss);
  log.info({ pid: process.pid }, "worker_started");

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    log.info({ signal }, "worker_stopping");
    try {
      await stopBoss();
      await closeDb();
    } finally {
      process.exit(0);
    }
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err: unknown) => {
  log.fatal({ err: safeErr(err) }, "worker_crashed");
  process.exit(1);
});
