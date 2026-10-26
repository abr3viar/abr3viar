import "server-only";
import { lt } from "drizzle-orm";
import { encryptField } from "@/server/crypto";
import { getDb } from "@/server/db/client";
import { accessLogs } from "@/server/db/schema";
import { getClientIp } from "@/server/http";
import { log, safeErr } from "@/server/log";

/** Marco Civil da Internet, art. 15: registros de acesso guardados por 6 meses. */
export const ACCESS_LOG_RETENTION_DAYS = 183;

export type AccessEvent = "login" | "upload" | "checkout" | "data_export" | "account_deletion";

/**
 * Registra o acesso (IP cifrado, data e hora) de um usuário. Nunca derruba a ação do usuário:
 * uma falha aqui só vai para o log (sem o IP). Precisa do contexto da requisição (cabeçalhos).
 */
export async function recordAccess(event: AccessEvent, userId: string): Promise<void> {
  try {
    const ip = await getClientIp();
    await getDb().insert(accessLogs).values({ userId, event, ip: encryptField(ip) });
  } catch (err) {
    log.warn({ event, err: safeErr(err) }, "access_log_failed");
  }
}

/** Apaga os registros com mais de 6 meses (job diário de limpeza). */
export async function purgeOldAccessLogs(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - ACCESS_LOG_RETENTION_DAYS * 86_400_000);
  const deleted = await getDb().delete(accessLogs).where(lt(accessLogs.occurredAt, cutoff)).returning({ id: accessLogs.id });
  return deleted.length;
}
