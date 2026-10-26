import { formatPrice } from "@/lib/views";
import { SubmitButton } from "../submit-button";
import { PaymentNotice } from "./payment-notice";

/** Botão de compra: preço em destaque acima e botão de largura total (UX-2). O preço vem sempre das props. */
export function CheckoutButton({
  conversationId,
  slug,
  priceCents,
  currency,
  purchasable,
  label,
  action,
}: {
  conversationId: string;
  slug: string;
  priceCents: number;
  currency: string;
  purchasable: boolean;
  label: string;
  action: (form: FormData) => Promise<void>;
}) {
  return (
    <div className="space-y-3">
      <p className="flex items-baseline justify-center gap-2">
        <span className="text-3xl font-bold text-wine-900">{formatPrice(priceCents, currency)}</span>
        <span className="text-sm text-muted">pagamento único, sem recorrência</span>
      </p>
      <form action={action}>
        <input type="hidden" name="conversationId" value={conversationId} />
        <input type="hidden" name="slug" value={slug} />
        <SubmitButton className="btn-primary min-h-12 w-full text-base sm:text-lg" disabled={!purchasable} pendingLabel="Abrindo o pagamento…">
          {label}
        </SubmitButton>
      </form>
      {purchasable ? (
        <PaymentNotice className="text-center" showSingle={false} />
      ) : (
        <p className="text-center text-sm text-amber-800">
          {/* "principal" = MAIN_REPORT_SLUG: sem pagamento, a análise some após 7 dias sem acesso (D17). */}
          {slug === "principal"
            ? "O pagamento ainda não está disponível. Volte mais tarde: esta análise fica guardada por 7 dias a partir do último acesso."
            : "O pagamento deste relatório ainda não está disponível. Volte mais tarde: o seu relatório completo continua disponível."}
        </p>
      )}
    </div>
  );
}
