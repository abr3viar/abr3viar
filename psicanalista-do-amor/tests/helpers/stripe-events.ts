import Stripe from "stripe";
import { grossFromNet } from "@/lib/pricing";

/** Preços cobrados (líquido + taxa padrão do Stripe), como o seed calcula. */
export const PRINCIPAL_GROSS = grossFromNet(3000, { percent: 3.99, fixedCents: 39 });
export const EXTRA_GROSS = grossFromNet(1000, { percent: 3.99, fixedCents: 39 });
export const SUBSCRIPTION_GROSS = grossFromNet(4699, { percent: 3.99, fixedCents: 39 });
export const OVERAGE_GROSS = grossFromNet(500, { percent: 3.99, fixedCents: 39 });

/** Assinatura do Stripe (forma da API atual: fim do período nos itens). */
export function stripeSubscription(overrides: Record<string, unknown> = {}, periodEndUnix = Math.floor(Date.now() / 1000) + 30 * 86_400) {
  return {
    id: `sub_test_${++counter}`,
    object: "subscription",
    customer: `cus_test_${counter}`,
    status: "active",
    livemode: false,
    cancel_at_period_end: false,
    items: { object: "list", data: [{ id: `si_${counter}`, current_period_end: periodEndUnix, current_period_start: periodEndUnix - 30 * 86_400 }] },
    ...overrides,
  };
}

const stripe = new Stripe("sk_test_dummy");
let counter = 0;

export function checkoutSession(overrides: Record<string, unknown> = {}) {
  return {
    id: `cs_test_${++counter}_${Math.random().toString(36).slice(2, 8)}`,
    object: "checkout.session",
    client_reference_id: null,
    payment_link: "plink_test_principal",
    amount_total: PRINCIPAL_GROSS,
    currency: "brl",
    mode: "payment",
    livemode: false,
    payment_status: "paid",
    status: "complete",
    payment_intent: `pi_test_${counter}`,
    payment_method_types: ["card"],
    ...overrides,
  };
}

export function event(type: string, object: Record<string, unknown>, id?: string, createdUnix = Math.floor(Date.now() / 1000)) {
  return {
    id: id ?? `evt_test_${++counter}_${Math.random().toString(36).slice(2, 8)}`,
    object: "event",
    type,
    livemode: false,
    created: createdUnix,
    data: { object },
  } as unknown as Stripe.Event;
}

export function signedRequest(evt: unknown, secret = process.env.STRIPE_WEBHOOK_SECRET!) {
  const payload = JSON.stringify(evt);
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret });
  return new Request("http://localhost:3000/api/webhooks/stripe", {
    method: "POST",
    headers: { "content-type": "application/json", "stripe-signature": header },
    body: payload,
  });
}
