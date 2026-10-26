/** Aviso junto de todo botão de compra (Termos §6): pagamento único, conteúdo digital e reembolso. */
export function PaymentNotice({ className = "", showSingle = true }: { className?: string; showSingle?: boolean }) {
  return (
    <div className={`space-y-1 text-xs text-stone-600 ${className}`}>
      <p>{showSingle && "Pagamento único, sem recorrência. "}Pagamento seguro pelo Stripe, com cartão ou Pix.</p>
      <p>
        Conteúdo digital, liberado assim que o pagamento é confirmado. Você pode pedir reembolso em até 7 dias pela{" "}
        <a href="/ajuda" className="underline underline-offset-2">Ajuda</a>.
      </p>
    </div>
  );
}

/** Aviso junto do botão de assinar (D96; Termos §6): recorrência, cancelamento e reembolso. */
export function SubscriptionNotice({ className = "" }: { className?: string }) {
  return (
    <div className={`space-y-1 text-xs text-stone-600 ${className}`}>
      <p>Assinatura mensal no cartão, pelo Stripe, renovada automaticamente todo mês até você cancelar.</p>
      <p>
        Cancele quando quiser em Minha conta: o acesso continua até o fim do período pago. Você pode pedir reembolso da primeira
        cobrança em até 7 dias pela <a href="/ajuda" className="underline underline-offset-2">Ajuda</a>.
      </p>
    </div>
  );
}
