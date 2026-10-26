import type { Queue } from "pg-boss";

/** Nomes das filas e formato (sem conteúdo sensível) de cada payload. */
export type QueuePayloads = {
  ingest: { conversationId: string };
  generate_main: { conversationId: string };
  generate_extra: { reportId: string };
  send_email: EmailJob;
  cleanup_files: Record<string, never>;
  retention: Record<string, never>;
  reconcile_payments: Record<string, never>;
  rotate_encryption_key: Record<string, never>;
  healthcheck: { at: string };
  /** Assinatura (D96): só IDs do Stripe, nada de dados pessoais. */
  subscription_sync: { stripeSubscriptionId: string };
  subscription_cancel: { stripeSubscriptionId: string; reason: string };
  subscription_dispute: { chargeId: string };
};

export type EmailJob =
  | { template: "analysis_ready"; conversationId: string }
  | { template: "report_unlocked"; reportId: string }
  | { template: "extra_ready"; reportId: string }
  | { template: "retention_warning"; conversationId: string }
  | { template: "data_deleted"; emailEncrypted: string }; // e-mail cifrado (o usuário já foi apagado)

export type QueueName = keyof QueuePayloads;

type Def = { queue: Omit<Queue, "name"> };

export const QUEUES: Record<QueueName, Def> = {
  // stately + singletonKey: no máximo 1 job na fila e 1 ativo por conversa/relatório.
  ingest: {
    queue: { policy: "stately", retryLimit: 2, retryDelay: 15, retryBackoff: true, expireInSeconds: 1800 },
  },
  generate_main: {
    queue: { policy: "stately", retryLimit: 2, retryDelay: 30, retryBackoff: true, expireInSeconds: 3600 },
  },
  generate_extra: {
    queue: { policy: "stately", retryLimit: 2, retryDelay: 30, retryBackoff: true, expireInSeconds: 3600 },
  },
  send_email: {
    queue: { policy: "standard", retryLimit: 5, retryDelay: 30, retryBackoff: true, expireInSeconds: 120 },
  },
  cleanup_files: { queue: { policy: "singleton", retryLimit: 1, expireInSeconds: 1800 } },
  retention: { queue: { policy: "singleton", retryLimit: 1, expireInSeconds: 3600 } },
  reconcile_payments: { queue: { policy: "singleton", retryLimit: 1, expireInSeconds: 900 } },
  rotate_encryption_key: { queue: { policy: "singleton", retryLimit: 0, expireInSeconds: 7200 } },
  healthcheck: {
    queue: { policy: "standard", retryLimit: 0, expireInSeconds: 60, deleteAfterSeconds: 3600 },
  },
  subscription_sync: {
    queue: { policy: "stately", retryLimit: 5, retryDelay: 30, retryBackoff: true, expireInSeconds: 120 },
  },
  subscription_cancel: {
    queue: { policy: "stately", retryLimit: 8, retryDelay: 60, retryBackoff: true, expireInSeconds: 120 },
  },
  subscription_dispute: {
    queue: { policy: "stately", retryLimit: 5, retryDelay: 60, retryBackoff: true, expireInSeconds: 120 },
  },
};
