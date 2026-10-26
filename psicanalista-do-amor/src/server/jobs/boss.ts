import "server-only";
import { sql } from "drizzle-orm";
import { PgBoss, fromDrizzle, type SendOptions } from "pg-boss";
import { getEnv } from "@/env";
import { connectionString, sslOption, type Tx } from "@/server/db/client";
import { log, safeErr } from "@/server/log";
import { QUEUES, type QueueName, type QueuePayloads } from "./definitions";

export const BOSS_SCHEMA = "pgboss";

type Role = "web" | "worker" | "migrate";
const holder = globalThis as unknown as { __pdaBoss?: Promise<PgBoss>; __pdaBossRole?: Role };

function createBoss(role: Role): PgBoss {
  getEnv();
  const boss = new PgBoss({
    connectionString: connectionString(),
    ssl: sslOption(),
    schema: BOSS_SCHEMA,
    application_name: `pda-${role}`,
    max: role === "web" ? 3 : 6,
    // Só o worker faz manutenção e agenda crons; o web apenas envia jobs.
    supervise: role === "worker",
    schedule: role === "worker",
    migrate: role !== "web",
    createSchema: role !== "web",
    registerInstance: role === "worker",
    instanceName: `pda-${role}`,
  });
  boss.on("error", (err: unknown) => log.error({ err: safeErr(err) }, "pg_boss_error"));
  return boss;
}

/** Instância única por processo. */
export function getBoss(role: Role = "web"): Promise<PgBoss> {
  if (!holder.__pdaBoss) {
    holder.__pdaBossRole = role;
    holder.__pdaBoss = (async () => {
      const boss = createBoss(role);
      await boss.start({ attempts: 3 });
      return boss;
    })().catch((err: unknown) => {
      holder.__pdaBoss = undefined;
      throw err;
    });
  }
  return holder.__pdaBoss;
}

export async function stopBoss(): Promise<void> {
  const p = holder.__pdaBoss;
  holder.__pdaBoss = undefined;
  if (p) await (await p).stop({ graceful: true, timeout: 20_000 });
}

/** Cria/atualiza as filas (idempotente). Chamado na migração de inicialização. */
export async function ensureQueues(boss: PgBoss): Promise<void> {
  for (const [name, def] of Object.entries(QUEUES)) {
    const existing = await boss.getQueue(name);
    if (!existing) {
      await boss.createQueue(name, def.queue);
    } else {
      const { policy: _policy, ...rest } = def.queue;
      void _policy;
      await boss.updateQueue(name, rest);
    }
  }
}

/**
 * Envia um job. Com `tx`, o job entra na MESMA transação do Drizzle (outbox):
 * se a transação for desfeita, o job também é.
 */
export async function enqueue<N extends QueueName>(
  name: N,
  data: QueuePayloads[N],
  options: SendOptions & { tx?: Tx } = {},
): Promise<string | null> {
  const { tx, ...rest } = options;
  const boss = await getBoss();
  return boss.send(name, data as object, {
    ...rest,
    ...(tx ? { db: fromDrizzle(tx, sql) } : {}),
  });
}
