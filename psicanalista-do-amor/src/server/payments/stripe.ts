import "server-only";
import Stripe from "stripe";
import { getEnv } from "@/env";

const holder = globalThis as unknown as { __pdaStripe?: Stripe };

export function getStripe(): Stripe {
  holder.__pdaStripe ??= new Stripe(getEnv().STRIPE_SECRET_KEY, {
    maxNetworkRetries: 2,
    timeout: 20_000,
    appInfo: { name: "psicanalista-do-amor" },
  });
  return holder.__pdaStripe;
}

/** Eventos que o endpoint do webhook precisa receber (cadastrar exatamente estes no Stripe). */
export const STRIPE_WEBHOOK_EVENTS = [
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "checkout.session.expired",
  "charge.refunded",
  "charge.dispute.created",
  // Assinatura mensal (D96): renovação, falha de cobrança e cancelamento.
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
] as const;

export type { Stripe };
