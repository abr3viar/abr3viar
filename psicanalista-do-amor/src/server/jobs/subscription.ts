import "server-only";
import { getEnv } from "@/env";
import { sendAlert } from "@/server/alerts";
import { log } from "@/server/log";
import { revokeSubscriptionsForDisputedCharge } from "@/server/payments/fulfill";
import { getStripe } from "@/server/payments/stripe";
import { cancelStripeSubscription, syncSubscriptionFromStripe } from "@/server/payments/subscriptions";
import type { JobHandler } from "./register";

/** Em dev/testes com chave falsa não há Stripe para consultar. */
function fakeStripe(): boolean {
  return getEnv().NODE_ENV !== "production" && /fake|dummy|e2e|mock/i.test(getEnv().STRIPE_SECRET_KEY);
}

/** Relê a assinatura na API do Stripe (corrige eventos fora de ordem, D96). */
export const handleSubscriptionSync: JobHandler<"subscription_sync"> = async (job) => {
  if (fakeStripe()) return;
  await syncSubscriptionFromStripe(job.data.stripeSubscriptionId);
};

/** Cancela no Stripe (reembolso, contestação, assinatura sem dono). Esgotou as tentativas: alerta. */
export const handleSubscriptionCancel: JobHandler<"subscription_cancel"> = async (job, ctx) => {
  if (fakeStripe()) return;
  try {
    await cancelStripeSubscription(job.data.stripeSubscriptionId);
    log.warn({ subscriptionId: job.data.stripeSubscriptionId, reason: job.data.reason }, "subscription_canceled_by_system");
  } catch (err) {
    if (ctx.isFinalAttempt) await sendAlert("assinatura_cancelar_manualmente", { assinatura: job.data.stripeSubscriptionId, motivo: job.data.reason });
    throw err;
  }
};

/** Contestação de uma cobrança sem compra avulsa: descobre o cliente e revoga a assinatura dele. */
export const handleSubscriptionDispute: JobHandler<"subscription_dispute"> = async (job) => {
  if (fakeStripe()) return;
  const charge = await getStripe().charges.retrieve(job.data.chargeId);
  const customer = typeof charge.customer === "string" ? charge.customer : (charge.customer?.id ?? null);
  if (!customer) return;
  await revokeSubscriptionsForDisputedCharge(customer, job.data.chargeId);
};
