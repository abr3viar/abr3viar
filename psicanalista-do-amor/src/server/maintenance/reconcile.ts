import "server-only";
import { inArray } from "drizzle-orm";
import type Stripe from "stripe";
import { isUuid } from "@/server/access";
import { getDb } from "@/server/db/client";
import { purchases } from "@/server/db/schema";
import { log, safeErr } from "@/server/log";
import { fulfillVerifiedSession } from "@/server/payments/fulfill";
import { getStripe } from "@/server/payments/stripe";

export type SessionLister = (sinceUnix: number) => AsyncIterable<Stripe.Checkout.Session>;

const defaultLister: SessionLister = (since) =>
  getStripe().checkout.sessions.list({ created: { gte: since }, status: "complete", limit: 100 });

/** O pagamento já foi reembolsado ou contestado? (a sessão continua "paid" depois disso) */
export type RefundCheck = (paymentIntentId: string) => Promise<boolean>;
const defaultRefundCheck: RefundCheck = async (pi) => {
  const intent = await getStripe().paymentIntents.retrieve(pi, { expand: ["latest_charge"] });
  const charge = intent.latest_charge;
  return typeof charge === "object" && charge !== null && (charge.refunded || charge.disputed);
};

/**
 * Reconciliação (R8): procura Checkout Sessions pagas dos últimos 3 dias cujo webhook
 * não chegou e libera pelo MESMO caminho (fulfill.ts), com as mesmas conferências.
 * A sessão vem da API autenticada do Stripe, então é tão confiável quanto o webhook.
 */
/** A assinatura da sessão ainda dá direito ao uso no Stripe? (não reembolsada, não cancelada) */
export type SubscriptionCheck = (stripeSubscriptionId: string) => Promise<boolean>;
const defaultSubscriptionCheck: SubscriptionCheck = async (id) => {
  const sub = await getStripe().subscriptions.retrieve(id);
  return sub.status === "active" || sub.status === "trialing";
};

export async function reconcilePayments(
  lister: SessionLister = defaultLister,
  refundCheck: RefundCheck = defaultRefundCheck,
  subscriptionCheck: SubscriptionCheck = defaultSubscriptionCheck,
): Promise<{ checked: number; unlocked: number }> {
  const since = Math.floor(Date.now() / 1000) - 3 * 86_400;
  const paid: Stripe.Checkout.Session[] = [];
  for await (const s of lister(since)) {
    if (s.payment_status === "paid" && isUuid(s.client_reference_id)) paid.push(s);
  }
  if (paid.length === 0) return { checked: 0, unlocked: 0 };
  const pending = new Set(
    (
      await getDb()
        .select({ id: purchases.id, status: purchases.status })
        .from(purchases)
        .where(inArray(purchases.id, paid.map((s) => s.client_reference_id!)))
    )
      .filter((p) => p.status === "pending")
      .map((p) => p.id),
  );
  let unlocked = 0;
  for (const s of paid) {
    if (!pending.has(s.client_reference_id!)) continue;
    try {
      // Webhook do pagamento E do reembolso perdidos: não libera pagamento já devolvido.
      // (Sessão de assinatura não tem PaymentIntent: o reembolso dela chega pelo evento da cobrança.)
      const pi = typeof s.payment_intent === "string" ? s.payment_intent : s.payment_intent?.id;
      if (pi && (await refundCheck(pi))) {
        log.warn({ sessionId: s.id }, "reconcile_skipped_refunded");
        continue;
      }
      const subId = typeof s.subscription === "string" ? s.subscription : s.subscription?.id;
      if (s.mode === "subscription" && subId && !(await subscriptionCheck(subId))) {
        log.warn({ sessionId: s.id }, "reconcile_skipped_subscription_inactive");
        continue;
      }
      const r = await fulfillVerifiedSession(s);
      if (r.outcome === "unlocked") unlocked++;
      log.warn({ sessionId: s.id, outcome: r.outcome }, "reconcile_fulfilled_missing_webhook");
    } catch (err) {
      log.error({ sessionId: s.id, err: safeErr(err) }, "reconcile_failed");
    }
  }
  return { checked: paid.length, unlocked };
}
