import type { Metadata } from "next";
import Link from "next/link";
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { getViewer } from "@/server/auth/session";
import { canAccess, sentWithoutLogin } from "@/server/access";
import { decryptNullable } from "@/server/crypto";
import { getDb } from "@/server/db/client";
import { conversations, reports } from "@/server/db/schema";
import { PRIVATE_ROBOTS } from "@/lib/seo";
import { DeleteConversation } from "@/components/delete-conversation";
import { ArrowRightIcon } from "@/components/icons";
import { deleteConversation } from "../r/[id]/actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Minhas análises", robots: PRIVATE_ROBOTS };

const STATUS: Record<string, string> = {
  uploaded: "Recebida",
  processing: "Processando",
  needs_confirmation: "Aguardando sua confirmação",
  generating: "Gerando relatório",
  ready: "Pronta",
  failed: "Falhou — tente de novo",
};

const fmt = (d: Date) => new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "medium" }).format(d);

export default async function MinhasAnalisesPage(props: { searchParams: Promise<{ excluida?: string }> }) {
  const { excluida } = await props.searchParams;
  const viewer = await getViewer();
  if (!viewer) {
    return (
      <div className="mx-auto max-w-xl px-4 py-12 text-center">
        <h1 className="font-serif text-3xl font-bold text-wine-900">Minhas análises</h1>
        <p className="mt-3 text-stone-600">Entre com o e-mail usado no envio para ver suas análises.</p>
        <Link href="/entrar" className="btn-primary mt-6">Receber link de acesso</Link>
      </div>
    );
  }
  const db = getDb();
  const rows = (
    await db
      .select()
      .from(conversations)
      .where(and(eq(conversations.userId, viewer.userId), ne(conversations.status, "deleted")))
      .orderBy(desc(conversations.createdAt))
  ).filter((c) => canAccess(viewer, c));
  const ids = rows.map((c) => c.id);
  const unlocked = new Set(
    ids.length
      ? (
          await db
            .select({ c: reports.conversationId })
            .from(reports)
            .where(and(eq(reports.isUnlocked, true), inArray(reports.conversationId, ids)))
        ).map((r) => r.c)
      : [],
  );

  const planted = await sentWithoutLogin(viewer, rows);

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="font-serif text-3xl font-bold text-wine-900">Minhas análises</h1>
      {excluida && <p role="status" className="mt-4 rounded-xl bg-green-50 p-4 text-sm text-green-900">Análise excluída.</p>}
      {!viewer.verified && (
        <p className="mt-4 rounded-xl bg-wine-50 p-4 text-sm text-wine-900">
          Você está vendo só as análises enviadas deste navegador. Para ver todas as análises do seu e-mail,{" "}
          <Link href="/entrar" className="link">entre com o link de acesso</Link>.
        </p>
      )}
      {rows.length === 0 ? (
        <div className="card mt-6 text-center">
          <p className="text-stone-600">Nenhuma análise por aqui ainda.</p>
          <Link href="/analisar" className="btn-primary mt-4">Analisar uma conversa</Link>
        </div>
      ) : (
        <ul className="mt-6 space-y-3">
          {rows.map((c) => {
            const a = decryptNullable(c.participantAName);
            const b = decryptNullable(c.participantBName);
            const title = a && b ? `${a} & ${b}` : "Conversa enviada";
            const href = c.status === "ready" ? `/r/${c.id}` : c.status === "needs_confirmation" ? `/r/${c.id}/confirmar` : `/r/${c.id}/processando`;
            return (
              <li key={c.id} className="overflow-hidden rounded-2xl border border-wine-100 bg-white shadow-sm">
                <Link href={href} className="flex items-center justify-between gap-4 p-5 hover:bg-wine-50/60 focus-visible:-outline-offset-2">
                  <div className="min-w-0">
                    <p className="font-semibold text-wine-900">{title}</p>
                    <p className="text-sm text-stone-600">
                      Enviada em {fmt(c.createdAt)} · {STATUS[c.status] ?? c.status}
                      {unlocked.has(c.id) ? " · Relatório completo" : ""}
                    </p>
                    <p className="text-xs text-stone-600">Exclusão automática em {fmt(c.expiresAt)} se não for acessada.</p>
                    {planted.has(c.id) && (
                      <p className="mt-1 text-xs font-medium text-amber-800">
                        Enviada sem entrar na conta, de outro aparelho ou navegador. Se não foi você, exclua.
                      </p>
                    )}
                  </div>
                  <ArrowRightIcon className="h-5 w-5 shrink-0 text-wine-600" />
                </Link>
                <div className="border-t border-wine-100 px-4 py-1">
                  <DeleteConversation conversationId={c.id} action={deleteConversation} label="Excluir" srContext={title} className="my-1" />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
