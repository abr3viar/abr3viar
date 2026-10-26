import type { Metadata } from "next";
import Link from "next/link";
import { AI_DISCLAIMER } from "@/lib/copy";
import { errorMessage } from "@/lib/messages";
import { formatPrice } from "@/lib/views";
import { SubmitButton } from "@/components/submit-button";
import { SubscriptionNotice } from "@/components/report/payment-notice";
import { getViewer } from "@/server/auth/session";
import { subscriptionStateFor } from "@/server/payments/subscriptions";
import { getSubscriptionOffer } from "@/server/reports/pricing";
import { startSubscriptionAction } from "../../conta/actions";

const DESCRIPTION = "Assinatura mensal do Psicanalista do Amor: até 10 relatórios completos por dia, com os relatórios adicionais incluídos.";
export const metadata: Metadata = {
  title: "Assinatura mensal",
  description: DESCRIPTION,
  alternates: { canonical: "/assinatura" },
  openGraph: { title: "Assinatura mensal · Psicanalista do Amor", description: DESCRIPTION, url: "/assinatura" },
};

export const dynamic = "force-dynamic";

/** Página da assinatura (D96). O preço vem do banco (preço cobrado); quem ativa é o webhook. */
export default async function AssinaturaPage(props: { searchParams: Promise<{ erro?: string }> }) {
  const { erro } = await props.searchParams;
  const [offer, viewer] = await Promise.all([getSubscriptionOffer(), getViewer()]);
  const state = await subscriptionStateFor(viewer);

  if (!offer) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-12 text-center">
        <h1 className="heading-1">Assinatura mensal</h1>
        <p className="mt-4 text-muted">A assinatura não está disponível no momento. Você pode comprar cada relatório separadamente.</p>
        <Link href="/analisar" className="btn-primary mt-6">Analisar uma conversa</Link>
      </div>
    );
  }

  const price = formatPrice(offer.priceCents, offer.currency);
  return (
    <div className="mx-auto max-w-2xl space-y-8 px-4 py-10">
      <header className="space-y-3 text-center">
        <p className="text-sm font-medium uppercase tracking-wide text-wine-600">Para quem analisa muitas conversas</p>
        <h1 className="heading-1 sm:text-4xl">Assinatura mensal</h1>
        <p className="text-4xl font-bold text-wine-800">
          {price}
          <span className="text-lg font-medium text-muted"> /mês</span>
        </p>
      </header>

      <ul className="card space-y-3 text-stone-700">
        <li>
          <strong>Até {offer.dailyLimit} relatórios completos por dia.</strong> O limite renova à meia-noite (horário de Brasília); o
          que não for usado no dia não acumula.
        </li>
        <li>
          <strong>Relatórios adicionais incluídos</strong>, sem custo extra, em todas as conversas com o relatório completo liberado.
        </li>
        {offer.overagePriceCents != null && (
          <li>
            Passou do limite no dia? Cada relatório completo a mais custa <strong>{formatPrice(offer.overagePriceCents, offer.currency)}</strong>.
          </li>
        )}
        <li>Cobrança mensal no cartão, com renovação automática. Cancele quando quiser em Minha conta: o acesso continua até o fim do período já pago.</li>
        <li>Para usar, entre pelo link enviado ao seu e-mail. A assinatura fica ligada a esse e-mail.</li>
      </ul>

      {erro && <p role="alert" className="rounded-control bg-amber-50 p-4 text-sm text-amber-900">{errorMessage(erro)}</p>}

      <div className="card space-y-4 text-center">
        {state?.active ? (
          <>
            <p className="text-wine-900">Sua assinatura está ativa.</p>
            <Link href="/conta#assinatura" className="btn-secondary w-full">Ver minha assinatura</Link>
          </>
        ) : !viewer?.verified ? (
          <>
            <p className="text-stone-700">Para assinar, entre pelo link que enviamos ao seu e-mail e volte a esta página.</p>
            <Link href="/entrar?assinar=1" className="btn-primary min-h-12 w-full text-lg">Entrar para assinar</Link>
          </>
        ) : (
          <form action={startSubscriptionAction}>
            <SubmitButton className="btn-primary min-h-12 w-full text-lg" disabled={!offer.purchasable} pendingLabel="Abrindo o pagamento…">
              Assinar por {price}/mês
            </SubmitButton>
            {!offer.purchasable && <p className="mt-2 text-sm text-amber-800">A assinatura ainda não está disponível. Volte mais tarde.</p>}
          </form>
        )}
        {!state?.active && <SubscriptionNotice className="text-center" />}
      </div>

      <p className="rounded-control bg-wine-50 p-3 text-xs leading-relaxed text-wine-900">{AI_DISCLAIMER}</p>
    </div>
  );
}
