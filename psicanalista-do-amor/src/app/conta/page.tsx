import type { Metadata } from "next";
import Link from "next/link";
import { getViewer } from "@/server/auth/session";
import { logoutAction, logoutEverywhereAction } from "../entrar/actions";
import { deleteAllDataAction, openBillingPortalAction } from "./actions";
import { PRIVATE_ROBOTS } from "@/lib/seo";
import { subscriptionStateFor } from "@/server/payments/subscriptions";
import type { SubscriptionStateView } from "@/lib/views";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Minha conta", robots: PRIVATE_ROBOTS };

const dateBR = (iso: string) => new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "long" }).format(new Date(iso));

/** Situação da assinatura em texto simples (D96). */
function subscriptionSummary(s: SubscriptionStateView): string {
  const end = s.currentPeriodEnd ? dateBR(s.currentPeriodEnd) : null;
  if (s.status === "revoked") return "Encerrada (a cobrança foi reembolsada).";
  if (s.active && s.cancelAtPeriodEnd) return end ? `Cancelada: vale até ${end} e não será renovada.` : "Cancelada: vale até o fim do período pago.";
  if (s.active) return end ? `Ativa. Próxima renovação em ${end}.` : "Ativa.";
  if (s.status === "past_due" || s.status === "unpaid") return "Pagamento pendente: atualize o cartão para voltar a usar.";
  if (s.status === "incomplete") return "Aguardando a confirmação do primeiro pagamento.";
  return "Encerrada.";
}

export default async function ContaPage(props: { searchParams: Promise<{ erro?: string }> }) {
  const { erro } = await props.searchParams;
  const viewer = await getViewer();
  const subscription = await subscriptionStateFor(viewer);
  if (!viewer) {
    return (
      <div className="mx-auto max-w-xl px-4 py-12 text-center">
        <h1 className="font-serif text-3xl font-bold text-wine-900">Minha conta</h1>
        <p className="mt-3 text-stone-600">Entre com seu e-mail para gerenciar seus dados.</p>
        <Link href="/entrar" className="btn-primary mt-6">Receber link de acesso</Link>
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-10">
      <h1 className="font-serif text-3xl font-bold text-wine-900">Minha conta</h1>
      <p className="text-stone-600">E-mail: <strong>{viewer.email}</strong></p>
      {!viewer.verified ? (
        <div className="card space-y-3">
          <p className="text-stone-700">
            Para exportar ou excluir todos os seus dados, confirme que o e-mail é seu entrando pelo link de acesso.
          </p>
          <Link href="/entrar" className="btn-primary">Receber link de acesso</Link>
        </div>
      ) : (
        <>
          <section id="assinatura" className="card space-y-3">
            <h2 className="font-semibold text-wine-900">Assinatura</h2>
            {erro === "portal" && (
              <p role="alert" className="text-sm text-red-700">Não foi possível abrir o gerenciamento da assinatura agora. Tente de novo em instantes.</p>
            )}
            {subscription ? (
              <>
                <p className="text-sm text-stone-700">{subscriptionSummary(subscription)}</p>
                {subscription.active && (
                  <p className="text-sm text-stone-700">
                    Hoje: {subscription.usedToday} de {subscription.dailyLimit} relatórios completos usados (renova à meia-noite, horário de Brasília).
                  </p>
                )}
                <form action={openBillingPortalAction}>
                  <button type="submit" className="btn-secondary">Gerenciar ou cancelar a assinatura</button>
                </form>
                <p className="text-xs text-stone-600">Abre a página segura do Stripe para trocar o cartão, ver as faturas ou cancelar.</p>
              </>
            ) : (
              <p className="text-sm text-stone-700">
                Você não tem assinatura. <Link href="/assinatura" className="underline underline-offset-2">Conheça a assinatura mensal</Link>.
              </p>
            )}
          </section>
          <section className="card space-y-3">
            <h2 className="font-semibold text-wine-900">Exportar meus dados</h2>
            <p className="text-sm text-stone-600">Baixe um arquivo JSON com suas análises, mensagens, relatórios liberados, compras e consentimentos.</p>
            <a href="/api/account/export" className="btn-secondary">Baixar meus dados (JSON)</a>
          </section>
          <section className="card space-y-3 border-red-200">
            <h2 className="font-semibold text-red-800">Excluir todos os meus dados</h2>
            <p className="text-sm text-stone-600">
              Apaga de forma definitiva todas as análises, conversas e relatórios. Registros de compra ficam apenas pelo prazo
              fiscal, sem nenhum conteúdo, e os registros de acesso (IP, data e hora) ficam por 6 meses, como exige o Marco Civil da
              Internet. Se você tiver assinatura, ela é cancelada na hora, sem novas cobranças. Não dá para desfazer.
            </p>
            {erro === "confirmacao" && <p role="alert" className="text-sm text-red-700">Digite EXCLUIR para confirmar.</p>}
            {erro === "assinatura" && (
              <p role="alert" className="text-sm text-red-700">
                Não conseguimos cancelar a sua assinatura no Stripe agora, então nada foi excluído. Tente de novo em instantes.
              </p>
            )}
            <form action={deleteAllDataAction} className="flex flex-wrap items-end gap-3">
              <label className="block">
                <span className="label">Digite EXCLUIR para confirmar</span>
                <input name="confirm" className="input" autoComplete="off" required />
              </label>
              <button type="submit" className="btn-danger">Excluir tudo</button>
            </form>
          </section>
        </>
      )}
      <div className="flex flex-wrap gap-3">
        <form action={logoutAction}>
          <button type="submit" className="btn-secondary">Sair</button>
        </form>
        {viewer.verified && (
          <form action={logoutEverywhereAction}>
            <button type="submit" className="btn-secondary">Sair de todos os aparelhos</button>
          </form>
        )}
      </div>
    </div>
  );
}
