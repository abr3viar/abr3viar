import { getOwnedConversation } from "@/server/access";
import { getViewer } from "@/server/auth/session";
import { jsonError, noStoreHeaders } from "@/server/http";
import { conversationStatusView } from "@/server/access";

export const dynamic = "force-dynamic";

/** Status para a tela de progresso (polling a cada 2 s). Só status e etapa — sem conteúdo. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const conv = await getOwnedConversation(id, await getViewer());
  if (!conv) return jsonError("not_found", 404);
  return Response.json(conversationStatusView(conv), { headers: noStoreHeaders() });
}
