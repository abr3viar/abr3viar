import { getViewer } from "@/server/auth/session";
import { jsonError, noStoreHeaders } from "@/server/http";
import { subscriptionStateFor } from "@/server/payments/subscriptions";

export const dynamic = "force-dynamic";

/**
 * A assinatura do usuário logado já está ativa? (polling da página de retorno, D96).
 * Só lê; quem ativa é o webhook. Só para sessão verificada.
 */
export async function GET() {
  const viewer = await getViewer();
  if (!viewer?.verified) return jsonError("not_found", 404);
  const state = await subscriptionStateFor(viewer);
  return Response.json({ active: Boolean(state?.active) }, { headers: noStoreHeaders() });
}
