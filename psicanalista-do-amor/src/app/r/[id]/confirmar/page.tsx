import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { ConfirmForm } from "@/components/confirm-form";
import { getOwnedConversation } from "@/server/access";
import { getViewer } from "@/server/auth/session";
import { decryptJson } from "@/server/crypto";
import type { DetectedSender } from "@/server/ingest/normalize";
import type { SenderView } from "@/lib/views";
import { confirmParticipants, deleteConversation } from "../actions";
import { PRIVATE_ROBOTS } from "@/lib/seo";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Confirmar participantes", robots: PRIVATE_ROBOTS };

/** Plural simples: 1 → singular; demais → plural (sem "(s)"). */
const plural = (n: number, one: string, many: string) => `${n.toLocaleString("pt-BR")} ${n === 1 ? one : many}`;

export default async function ConfirmarPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const conv = await getOwnedConversation(id, await getViewer());
  if (!conv) notFound();
  if (conv.status !== "needs_confirmation" || !conv.detectedSenders) redirect(`/r/${conv.id}/processando`);

  const detected = decryptJson(conv.detectedSenders) as DetectedSender[];
  const senders: SenderView[] = detected.map((s) => ({
    index: s.index,
    label: s.raw,
    count: s.count,
    samples: s.samples,
    side: s.side ?? null,
    suggested: s.suggested,
  }));
  const w = conv.warnings ?? {};

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="font-serif text-3xl font-bold text-wine-900">Quem é quem na conversa?</h1>
      <p className="mt-2 text-stone-600">
        Encontramos {plural(conv.messageCount, "mensagem", "mensagens")}. Confira os nomes e, se quiser, indique qual das
        duas pessoas é você.
      </p>
      <div className="mt-4 space-y-2">
        {typeof w.few_messages === "number" && (
          <p className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900">
            A conversa tem poucas mensagens de texto ({w.few_messages}). O relatório pode ficar pouco preciso, mas você pode seguir.
          </p>
        )}
        {typeof w.ocr_low_confidence === "number" && (
          <p className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900">
            {w.ocr_low_confidence === 1
              ? "1 mensagem ficou difícil de ler nas prints."
              : `${plural(w.ocr_low_confidence, "mensagem", "mensagens")} ficaram difíceis de ler nas prints.`}{" "}
            Se possível, envie imagens mais nítidas.
          </p>
        )}
        {typeof w.duplicate_images === "number" && (
          <p className="rounded-xl bg-stone-100 p-4 text-sm text-stone-700">
            {w.duplicate_images === 1
              ? "1 print repetida foi ignorada."
              : `${plural(w.duplicate_images, "print repetida", "prints repetidas")} foram ignoradas.`}
          </p>
        )}
        {typeof w.truncated_to_last === "number" && (
          <p className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900">
            A conversa é muito longa: vamos analisar as últimas {plural(w.truncated_to_last, "mensagem", "mensagens")}.
          </p>
        )}
        {w.single_sender === true && (
          <p className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900">
            Só encontramos mensagens de uma pessoa. Confira se a conversa foi exportada inteira.
          </p>
        )}
      </div>
      <div className="mt-8">
        {senders.length >= 2 ? (
          <ConfirmForm
            conversationId={conv.id}
            senders={senders}
            timezone={conv.timezone}
            hasTimestamps={conv.hasTimestamps}
            action={confirmParticipants}
          />
        ) : (
          <div className="card space-y-4">
            <p>Precisamos de mensagens de duas pessoas para fazer a análise.</p>
            <form action={deleteConversation}>
              <input type="hidden" name="conversationId" value={conv.id} />
              <input type="hidden" name="confirm" value="sim" />
              <button className="btn-secondary" type="submit">Excluir e enviar outra conversa</button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
