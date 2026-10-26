import Link from "next/link";
import { formatPrice, type SubscriptionOfferView, type SubscriptionStateView } from "@/lib/views";
import { ArrowRightIcon } from "../icons";
import { SubmitButton } from "../submit-button";
import { CheckoutButton } from "./checkout-button";

/**
 * Compra do relatório principal conforme a assinatura (D96):
 * - assinante com relatórios sobrando hoje: libera sem pagar (conta 1 no limite);
 * - assinante que já usou o limite do dia: relatório a mais, pagamento avulso;
 * - demais: compra avulsa de sempre + convite discreto para a assinatura.
 * Recebe só views; quem confere tudo de novo é o servidor (fulfill.ts / start-checkout.ts).
 */
export function SubscriptionAwareCheckout({
  conversationId,
  slug,
  priceCents,
  currency,
  purchasable,
  overageSlug,
  subscription,
  offer,
  viewerVerified,
  checkoutAction,
  unlockAction,
}: {
  conversationId: string;
  slug: string;
  priceCents: number;
  currency: string;
  purchasable: boolean;
  overageSlug: string;
  subscription: SubscriptionStateView | null;
  offer: SubscriptionOfferView | null;
  viewerVerified: boolean;
  checkoutAction: (form: FormData) => Promise<void>;
  unlockAction: (form: FormData) => Promise<void>;
}) {
  if (subscription?.active && subscription.remainingToday > 0) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-wine-900">
          Incluído na sua assinatura. Hoje ainda {subscription.remainingToday === 1 ? "resta 1 relatório" : `restam ${subscription.remainingToday} relatórios`}{" "}
          de {subscription.dailyLimit}.
        </p>
        <form action={unlockAction}>
          <input type="hidden" name="conversationId" value={conversationId} />
          <SubmitButton className="btn-primary min-h-12 w-full text-base sm:text-lg" pendingLabel="Liberando…">
            Ver o relatório completo
          </SubmitButton>
        </form>
      </div>
    );
  }
  if (subscription?.active) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-wine-900">
          Você já usou os {subscription.dailyLimit} relatórios completos de hoje. O limite renova à meia-noite (horário de Brasília).
        </p>
        {offer?.overagePriceCents ? (
          <CheckoutButton
            conversationId={conversationId}
            slug={overageSlug}
            priceCents={offer.overagePriceCents}
            currency={offer.currency}
            purchasable={offer.overagePurchasable}
            label="Liberar este relatório agora"
            action={checkoutAction}
          />
        ) : (
          <p className="text-sm text-stone-600">Volte amanhã para liberar este relatório pela assinatura.</p>
        )}
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <CheckoutButton
        conversationId={conversationId}
        slug={slug}
        priceCents={priceCents}
        currency={currency}
        purchasable={purchasable}
        label="Desbloquear relatório completo"
        action={checkoutAction}
      />
      {offer?.purchasable && (
        <div className="border-t border-wine-100 pt-3 text-sm text-stone-700">
          {viewerVerified ? (
            <p>
              Analisa muitas conversas? Com a assinatura de {formatPrice(offer.priceCents, offer.currency)}/mês, você libera até{" "}
              {offer.dailyLimit} relatórios completos por dia, com os adicionais incluídos.{" "}
              <Link href="/assinatura" className="inline-flex items-center gap-1 font-medium text-wine-700 underline underline-offset-2">
                Conhecer a assinatura
                <ArrowRightIcon className="h-3.5 w-3.5" />
              </Link>
            </p>
          ) : (
            <p>
              Já é assinante?{" "}
              <Link href="/entrar" className="font-medium text-wine-700 underline underline-offset-2">
                Entre pelo link do e-mail
              </Link>{" "}
              para usar a sua assinatura. Ou{" "}
              <Link href="/assinatura" className="font-medium text-wine-700 underline underline-offset-2">
                conheça a assinatura
              </Link>
              : até {offer.dailyLimit} relatórios completos por dia por {formatPrice(offer.priceCents, offer.currency)}/mês.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
