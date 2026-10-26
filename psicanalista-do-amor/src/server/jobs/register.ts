import "server-only";
import type { PgBoss, JobWithMetadata } from "pg-boss";
import { getEnv } from "@/env";
import { log, safeErr } from "@/server/log";
import { sendAlert } from "@/server/alerts";
import type { QueueName, QueuePayloads } from "./definitions";

export type JobHandler<N extends QueueName> = (
  job: JobWithMetadata<QueuePayloads[N]>,
  ctx: { isFinalAttempt: boolean },
) => Promise<void>;

type HandlerMap = { [N in QueueName]?: JobHandler<N> };

async function loadHandlers(): Promise<HandlerMap> {
  const [{ handleIngest }, { handleGenerateMain }, { handleGenerateExtra }, { handleSendEmail }] =
    await Promise.all([
      import("./ingest"),
      import("./generate-main"),
      import("./generate-extra"),
      import("./send-email"),
    ]);
  const maintenance = await import("./maintenance");
  const subscription = await import("./subscription");
  return {
    ingest: handleIngest,
    generate_main: handleGenerateMain,
    generate_extra: handleGenerateExtra,
    send_email: handleSendEmail,
    cleanup_files: maintenance.handleCleanupFiles,
    retention: maintenance.handleRetention,
    reconcile_payments: maintenance.handleReconcilePayments,
    rotate_encryption_key: maintenance.handleRotateEncryptionKey,
    subscription_sync: subscription.handleSubscriptionSync,
    subscription_cancel: subscription.handleSubscriptionCancel,
    subscription_dispute: subscription.handleSubscriptionDispute,
    healthcheck: async (job) => {
      log.info({ jobId: job.id }, "healthcheck_job_ok");
    },
  };
}

const CONCURRENCY: Partial<Record<QueueName, number>> = {
  ingest: 2,
  generate_main: 2,
  generate_extra: 2,
  send_email: 4,
};

export async function registerHandlers(boss: PgBoss): Promise<void> {
  const handlers = await loadHandlers();
  for (const [name, handler] of Object.entries(handlers) as [QueueName, JobHandler<QueueName>][]) {
    const options = {
      includeMetadata: true,
      localConcurrency: CONCURRENCY[name] ?? 1,
      pollingIntervalSeconds: 1,
    } as const;
    await boss.work<QueuePayloads[typeof name], unknown, typeof options>(
      name,
      options,
      async (jobs) => {
        for (const job of jobs) {
          const started = Date.now();
          const isFinalAttempt = job.retryCount >= job.retryLimit;
          try {
            await handler(job, { isFinalAttempt });
            log.info({ queue: name, jobId: job.id, ms: Date.now() - started }, "job_done");
          } catch (err) {
            log.warn(
              { queue: name, jobId: job.id, attempt: job.retryCount, err: safeErr(err) },
              "job_failed",
            );
            if (isFinalAttempt) await sendAlert("job_falhou", { fila: name, job: job.id });
            throw err;
          }
        }
      },
    );
  }

  // Agendamentos (fuso de São Paulo).
  const tz = "America/Sao_Paulo";
  await boss.schedule("cleanup_files", "17 * * * *", {}, { tz });
  await boss.schedule("retention", "23 4 * * *", {}, { tz });
  await boss.schedule("reconcile_payments", "*/30 * * * *", {}, { tz });
  log.info({ queues: Object.keys(handlers).length, groqConcurrency: getEnv().GROQ_MAX_CONCURRENCY }, "worker_handlers_registered");
}
