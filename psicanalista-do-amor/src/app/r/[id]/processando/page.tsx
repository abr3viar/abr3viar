import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { ProgressPoller } from "@/components/progress-poller";
import { conversationStatusView, getOwnedConversation } from "@/server/access";
import { getViewer } from "@/server/auth/session";
import { reprocessConversation } from "../actions";
import { errorMessage } from "@/lib/messages";
import { PRIVATE_ROBOTS } from "@/lib/seo";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Processando", robots: PRIVATE_ROBOTS };

export default async function ProcessandoPage(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ erro?: string }>;
}) {
  const { id } = await props.params;
  const { erro } = await props.searchParams;
  const conv = await getOwnedConversation(id, await getViewer());
  if (!conv) notFound();
  if (conv.status === "needs_confirmation") redirect(`/r/${conv.id}/confirmar`);
  if (conv.status === "ready") redirect(`/r/${conv.id}`);
  return (
    <div className="mx-auto max-w-xl px-4 py-12">
      <h1 className="mb-6 heading-1">Analisando a conversa</h1>
      {erro && <p className="mb-4 rounded-control bg-amber-50 p-4 text-sm text-amber-900">{errorMessage(erro)}</p>}
      <ProgressPoller
        conversationId={conv.id}
        initial={conversationStatusView(conv)}
        retryAction={reprocessConversation}
      />
    </div>
  );
}
