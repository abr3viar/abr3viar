import { getViewer } from "@/server/auth/session";
import { exportUserData } from "@/server/account-export";
import { getClientIp, jsonError } from "@/server/http";
import { log } from "@/server/log";
import { consumeRateLimit } from "@/server/rate-limit";
import { recordAccess } from "@/server/access-log";

export const dynamic = "force-dynamic";

/** Exporta os dados do titular. Só para sessão verificada (link mágico). */
export async function GET() {
  const viewer = await getViewer();
  if (!viewer?.verified) return jsonError("login_required", 401);
  if (!(await consumeRateLimit("export", [`user:${viewer.userId}`, `ip:${await getClientIp()}`]))) {
    return jsonError("rate_limited", 429);
  }
  await recordAccess("data_export", viewer.userId);
  const data = await exportUserData(viewer.userId);
  if (!data) return jsonError("not_found", 404);
  log.info({ userId: viewer.userId }, "account_exported");
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": 'attachment; filename="psicanalista-do-amor-meus-dados.json"',
      "Cache-Control": "private, no-store",
    },
  });
}
