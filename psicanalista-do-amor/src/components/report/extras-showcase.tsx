import Link from "next/link";
import { formatPrice, type ExtraOfferView } from "@/lib/views";
import { ArrowRightIcon } from "../icons";
import { SubmitButton } from "../submit-button";
import { PaymentNotice } from "./payment-notice";

/**
 * Vitrine de relatórios adicionais (só aparece com o principal pago). No celular é uma
 * lista única (sem parede de botões iguais); a partir de `sm`, cartões em duas colunas.
 */
export function ExtrasShowcase({
  conversationId,
  offers,
  action,
  includedAction = null,
  setUserSideAction,
  names,
}: {
  conversationId: string;
  offers: ExtraOfferView[];
  action: (form: FormData) => Promise<void>;
  /** Assinante ativo (D96): os adicionais são gerados sem cobrança. */
  includedAction?: ((form: FormData) => Promise<void>) | null;
  setUserSideAction: (form: FormData) => Promise<void>;
  names: { a: string; b: string };
}) {
  if (offers.length === 0) return null;
  return (
    <section aria-labelledby="extras" className="space-y-4">
      <div>
        <h2 id="extras" className="font-serif text-2xl font-semibold text-wine-900">Quer ir mais fundo?</h2>
        <p className="mt-1 text-stone-600">
          Relatórios adicionais sobre a mesma conversa, gerados na hora.
          {includedAction && " Incluídos na sua assinatura."}
        </p>
      </div>
      <ul className="divide-y divide-wine-100 rounded-2xl border border-wine-100 bg-white shadow-sm sm:grid sm:grid-cols-2 sm:gap-4 sm:divide-y-0 sm:border-0 sm:bg-transparent sm:shadow-none">
        {offers.map((o) => (
          <li key={o.slug} className="sm:flex">
            <article className="flex w-full flex-col gap-3 p-5 sm:rounded-2xl sm:border sm:border-wine-100 sm:bg-white sm:shadow-sm">
              <div className="flex-1">
                <h3 className="font-semibold text-wine-900">{o.name}</h3>
                <p className="mt-1 text-sm text-stone-600">{o.teaser}</p>
              </div>
              {o.state === "ready" || o.state === "queued" || o.state === "generating" || o.state === "failed" ? (
                <Link href={`/r/${conversationId}/extra/${o.slug}`} className="btn-secondary px-4 text-sm sm:w-full sm:text-base">
                  {o.state === "ready" ? "Ler relatório" : "Acompanhar geração"}
                  <ArrowRightIcon className="h-4 w-4" />
                </Link>
              ) : o.blockedReason === "needs_user_side" ? (
                <form action={setUserSideAction} className="space-y-2">
                  <input type="hidden" name="conversationId" value={conversationId} />
                  <p className="text-sm text-amber-800">Para este relatório, diga qual das duas pessoas é você:</p>
                  <div className="grid grid-cols-2 gap-2">
                    <SubmitButton name="userIs" value="a" className="btn-secondary min-h-11 px-3 text-sm">Sou {names.a}</SubmitButton>
                    <SubmitButton name="userIs" value="b" className="btn-secondary min-h-11 px-3 text-sm">Sou {names.b}</SubmitButton>
                  </div>
                </form>
              ) : includedAction ? (
                <form action={includedAction}>
                  <input type="hidden" name="conversationId" value={conversationId} />
                  <input type="hidden" name="slug" value={o.slug} />
                  <SubmitButton className="btn-secondary px-4 text-sm font-semibold sm:w-full sm:text-base" pendingLabel="Preparando…">
                    Gerar relatório (incluído)
                  </SubmitButton>
                </form>
              ) : (
                <form action={action}>
                  <input type="hidden" name="conversationId" value={conversationId} />
                  <input type="hidden" name="slug" value={o.slug} />
                  <SubmitButton className="btn-secondary px-4 text-sm font-semibold sm:w-full sm:text-base" disabled={!o.purchasable} pendingLabel="Abrindo o pagamento…">
                    Comprar — {formatPrice(o.priceCents, o.currency)}
                  </SubmitButton>
                  {!o.purchasable && <p className="mt-2 text-xs text-amber-800">Em breve.</p>}
                </form>
              )}
            </article>
          </li>
        ))}
      </ul>
      {!includedAction && <PaymentNotice />}
    </section>
  );
}
