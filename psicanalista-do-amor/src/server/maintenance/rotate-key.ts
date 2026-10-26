import "server-only";
import { asc, gt, sql } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import { getEnv } from "@/env";
import { encryptField, isEncryptedWithPreviousKey, looksEncrypted, reencryptField } from "@/server/crypto";
import { getDb } from "@/server/db/client";
import {
  accessLogs,
  auditLog,
  conversationDigests,
  conversationFiles,
  conversations,
  messages,
  reportSections,
  reports,
} from "@/server/db/schema";
import { log } from "@/server/log";

/** Todas as colunas cifradas na aplicação (🔒 no plano.md, seção 3). */
const TARGETS: { name: string; table: PgTable; id: PgColumn; columns: PgColumn[] }[] = [
  {
    name: "conversations",
    table: conversations,
    id: conversations.id,
    columns: [conversations.participantAName, conversations.participantBName, conversations.detectedSenders],
  },
  { name: "conversation_files", table: conversationFiles, id: conversationFiles.id, columns: [conversationFiles.originalName] },
  { name: "messages", table: messages, id: messages.id, columns: [messages.senderRaw, messages.content] },
  { name: "conversation_digests", table: conversationDigests, id: conversationDigests.id, columns: [conversationDigests.content] },
  { name: "reports", table: reports, id: reports.id, columns: [reports.hookText, reports.verdict] },
  { name: "access_logs", table: accessLogs, id: accessLogs.id, columns: [accessLogs.ip] },
  {
    name: "report_sections",
    table: reportSections,
    id: reportSections.id,
    columns: [reportSections.title, reportSections.lockedTitle, reportSections.content, reportSections.evidence],
  },
];

const BATCH = 500;

/**
 * Rotação de DATA_ENCRYPTION_KEY (plano.md 10.2): com a chave nova em
 * DATA_ENCRYPTION_KEY e a antiga em DATA_ENCRYPTION_KEY_PREVIOUS, re-cifra tudo o
 * que ainda estiver com a chave antiga. Idempotente e em lotes.
 */
export async function rotateEncryptionKey(): Promise<{ updated: number }> {
  if (!getEnv().DATA_ENCRYPTION_KEY_PREVIOUS) {
    log.info({}, "rotate_key_skipped_no_previous");
    return { updated: 0 };
  }
  const db = getDb();
  let updated = 0;
  for (const target of TARGETS) {
    let lastId: string | null = null;
    for (;;) {
      const selection = Object.fromEntries([["id", target.id], ...target.columns.map((c) => [c.name, c])]) as Record<string, PgColumn>;
      const rows = (await db
        .select(selection)
        .from(target.table)
        .where(lastId ? gt(target.id, lastId) : undefined)
        .orderBy(asc(target.id))
        .limit(BATCH)) as Record<string, string | null>[];
      if (rows.length === 0) break;
      for (const row of rows) {
        const changes: [string, string][] = [];
        for (const col of target.columns) {
          const value = row[col.name];
          if (!value) continue;
          // Linhas antigas de colunas que passaram a ser cifradas (locked_title, D83).
          if (!looksEncrypted(value)) changes.push([col.name, encryptField(value)]);
          else if (isEncryptedWithPreviousKey(value)) changes.push([col.name, reencryptField(value)]);
        }
        if (changes.length) {
          const assignments = sql.join(
            changes.map(([k, v]) => sql`${sql.identifier(k)} = ${v}`),
            sql`, `,
          );
          await db.execute(sql`UPDATE ${target.table} SET ${assignments} WHERE ${target.id} = ${row.id}`);
          updated++;
        }
      }
      lastId = rows[rows.length - 1]!.id as string;
    }
    log.info({ table: target.name }, "rotate_key_table_done");
  }
  await db.insert(auditLog).values({ action: "crypto.key_rotated", meta: { updated } });
  log.info({ updated }, "rotate_key_done");
  return { updated };
}
