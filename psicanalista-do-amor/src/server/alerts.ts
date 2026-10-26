import "server-only";
import { getEnv } from "@/env";
import { log } from "@/server/log";

/**
 * Alertas operacionais SEM dados pessoais (plano.md, Fase 5): se ALERT_WEBHOOK_URL
 * estiver definida (Discord, Slack ou similar), envia uma linha curta com código e IDs.
 * No máximo 1 alerta por código a cada 5 minutos por processo.
 */
const last = new Map<string, number>();

export async function sendAlert(code: string, details: Record<string, string | number | null | undefined> = {}): Promise<void> {
  let url: string | undefined;
  try {
    url = getEnv().ALERT_WEBHOOK_URL;
  } catch {
    // env inválido: o erro de configuração já aparece no log da inicialização
    return;
  }
  if (!url) return;
  const now = Date.now();
  // Dedup por código + detalhe de erro: um "duplicate_payment" não some atrás de outro erro.
  const key = `${code}:${details.erro ?? ""}`;
  if ((last.get(key) ?? 0) > now - 5 * 60_000) return;
  last.set(key, now);
  const text = `⚠️ Psicanalista do Amor: ${code}${Object.entries(details)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => ` · ${k}=${v}`)
    .join("")}`;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, content: text }),
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    log.warn({ code }, "alert_send_failed");
  }
}
