import type { Metadata } from "next";
import Link from "next/link";
import { PaymentReturnPoller } from "@/components/payment-return-poller";
import { SubscriptionReturnPoller } from "@/components/subscription-return-poller";
import { SUBSCRIPTION_SLUG } from "@/server/reports/catalog";
import { getViewer } from "@/server/auth/session";
import { findLatestPurchaseForUser } from "@/server/payments/latest-purchase";
import { PRIVATE_ROBOTS } from "@/lib/seo";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Confirmando pagamento", robots: PRIVATE_ROBOTS };

/**
 * Página de retorno do Payment Link (plano.md 6.4). Descobre a compra pela SESSÃO do
 * usuário (nunca pela URL) e só acompanha o status — quem libera é o webhook.
 */
export default async function PagamentoRetornoPage(props: { searchParams: Promise<{ link?: string | string[] }> }) {
  const { link } = await props.searchParams;
  const viewer = await getViewer();
  if (!viewer) {
    return (
      <div className="mx-auto max-w-xl px-4 py-12 text-center">
        <h1 className="font-serif text-2xl font-bold text-wine-900">Acabou de pagar?</h1>
        <p className="mt-3 text-stone-600">
          Entre com o mesmo e-mail usado no envio da conversa para ver o relatório. Você também recebe um e-mail quando ele
          estiver pronto para ler.
        </p>
        <Link href="/entrar" className="btn-primary mt-6">Entrar com meu e-mail</Link>
      </div>
    );
  }
  // Assinatura (D96): acompanha a ativação (só lê; quem ativa é o webhook).
  if (link === SUBSCRIPTION_SLUG && viewer.verified) {
    return (
      <div className="mx-auto max-w-xl px-4 py-12 text-center">
        <SubscriptionReturnPoller />
      </div>
    );
  }
  const latest = await findLatestPurchaseForUser(viewer, typeof link === "string" ? link : null);

  return (
    <div className="mx-auto max-w-xl px-4 py-12 text-center">
      {latest ? (
        // O título muda com o estado (aguardando, parado, falhou): fica no componente.
        <PaymentReturnPoller reportId={latest.reportId} />
      ) : (
        <>
          <h1 className="font-serif text-2xl font-bold text-wine-900">Não encontramos uma compra recente</h1>
          <p className="mt-4 text-stone-600">
            Não há um pagamento em andamento neste acesso. Veja suas análises em{" "}
            <Link href="/minhas-analises" className="link">Minhas análises</Link>. Se você pagou, também recebe um e-mail
            quando o relatório estiver pronto para ler.
          </p>
        </>
      )}
    </div>
  );
}
