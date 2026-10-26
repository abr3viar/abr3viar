import "server-only";
import { getEnv } from "@/env";
import { log, safeErr } from "@/server/log";
import { getStripe } from "./stripe";

export type LinkCheck =
  | { ok: true }
  | { ok: false; reason: "price_mismatch"; linkCents: number; expectedCents: number }
  | {
      ok: false;
      reason: "currency_mismatch" | "custom_amount" | "link_options" | "billing_mismatch" | "url_mismatch" | "redirect_mismatch" | "not_found" | "unavailable";
    };

/**
 * Confere na API do Stripe se o Payment Link cobra EXATAMENTE o preço calculado (bruto) em BRL:
 * mais barato, o webhook recusa (mismatch_amount); mais caro, o cliente paga mais que o anunciado.
 * Melhor esforço: sem rede/chave real, retorna "unavailable" e o admin só vê um aviso.
 */
/**
 * `billing: "monthly"` (assinatura, D96): o preço precisa ser recorrente mensal e sem período
 * de teste. Padrão `"one_time"`: relatórios são pagamento único.
 */
export async function checkPaymentLinkPrice(
  linkId: string,
  expectedCents: number,
  expectedUrl?: string | null,
  billing: "one_time" | "monthly" = "one_time",
  /** Exige `?link=<slug>` no redirect (assinatura e além do limite: a página de retorno depende dele). */
  requiredSlug?: string,
): Promise<LinkCheck> {
  if (getEnv().NODE_ENV !== "production" && /fake|dummy|e2e/i.test(getEnv().STRIPE_SECRET_KEY)) return { ok: false, reason: "unavailable" };
  try {
    const stripe = getStripe();
    const link = await stripe.paymentLinks.retrieve(linkId);
    // Quantidade ajustável deixa pagar várias unidades por um relatório; cupom gera
    // mismatch_amount no webhook (o cliente paga e o relatório não libera).
    if (link.allow_promotion_codes || (link.optional_items?.length ?? 0) > 0) return { ok: false, reason: "link_options" };
    // Link desativado ou URL colada de OUTRO link: o cliente iria para um checkout diferente.
    if (!link.active) return { ok: false, reason: "not_found" };
    // Imposto automático ou frete somariam ao preço anunciado; o redirect precisa voltar ao site.
    if (link.automatic_tax?.enabled || (link.shipping_options?.length ?? 0) > 0) return { ok: false, reason: "link_options" };
    const returnBase = `${getEnv().APP_URL.replace(/\/+$/, "")}/pagamento/retorno`;
    if (link.after_completion?.type !== "redirect" || !link.after_completion.redirect?.url?.startsWith(returnBase)) {
      return { ok: false, reason: "redirect_mismatch" };
    }
    if (requiredSlug) {
      let slug: string | null = null;
      try {
        slug = new URL(link.after_completion.redirect.url).searchParams.get("link");
      } catch {
        slug = null;
      }
      if (slug !== requiredSlug) return { ok: false, reason: "redirect_mismatch" };
    }
    if (expectedUrl && link.url && link.url.replace(/\/+$/, "") !== expectedUrl.replace(/\/+$/, "")) return { ok: false, reason: "url_mismatch" };
    const items = await stripe.paymentLinks.listLineItems(linkId, { limit: 5 });
    if (items.data.length !== 1) return { ok: false, reason: "link_options" };
    const item = items.data[0];
    if (!item?.price) return { ok: false, reason: "not_found" };
    if (item.adjustable_quantity?.enabled) return { ok: false, reason: "link_options" };
    if ((item.price.currency ?? "").toLowerCase() !== "brl") return { ok: false, reason: "currency_mismatch" };
    // "Cliente escolhe o valor" (custom_unit_amount) não tem preço fixo: não serve.
    if (item.price.custom_unit_amount || item.price.unit_amount === null) return { ok: false, reason: "custom_amount" };
    if (billing === "monthly") {
      // Assinatura: cobrança mensal (1 mês), sem teste grátis (o acesso só vale com a 1ª cobrança paga).
      const r = item.price.recurring;
      if (item.price.type !== "recurring" || !r || r.interval !== "month" || r.interval_count !== 1) return { ok: false, reason: "billing_mismatch" };
      if (link.subscription_data?.trial_period_days) return { ok: false, reason: "billing_mismatch" };
    } else if (item.price.type !== "one_time" || item.price.recurring) {
      // Preço recorrente (assinatura) não serve: o relatório é pagamento único.
      return { ok: false, reason: "link_options" };
    }
    if ((item.quantity ?? 1) !== 1) return { ok: false, reason: "price_mismatch", linkCents: item.amount_total, expectedCents };
    const linkCents = item.price.unit_amount;
    if (linkCents !== expectedCents) return { ok: false, reason: "price_mismatch", linkCents, expectedCents };
    return { ok: true };
  } catch (err) {
    log.warn({ err: safeErr(err) }, "payment_link_check_failed");
    const status = (err as { statusCode?: number }).statusCode;
    return { ok: false, reason: status === 404 ? "not_found" : "unavailable" };
  }
}
