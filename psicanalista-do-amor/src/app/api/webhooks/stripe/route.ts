import { getEnv } from "@/env";
import { BodyTimeoutError, readBodyLimited } from "@/server/http";
import { log, safeErr } from "@/server/log";
import { sendAlert } from "@/server/alerts";
import { processStripeEvent } from "@/server/payments/fulfill";
import { getStripe } from "@/server/payments/stripe";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BODY_BYTES = 1_048_576;

/**
 * Webhook do Stripe (plano.md 6.3). Corpo CRU + assinatura obrigatória; idempotente.
 * Nunca registra o payload (só id, tipo e resultado).
 */
export async function POST(req: Request) {
  const signature = req.headers.get("stripe-signature");
  if (!signature) return new Response("missing signature", { status: 400 });
  let raw: Buffer | null;
  try {
    raw = await readBodyLimited(req, MAX_BODY_BYTES, 15_000);
  } catch (err) {
    return new Response(err instanceof BodyTimeoutError ? "timeout" : "bad request", { status: err instanceof BodyTimeoutError ? 408 : 400 });
  }
  if (!raw) return new Response("too large", { status: 413 });
  const body = raw.toString("utf8");

  let event;
  try {
    event = getStripe().webhooks.constructEvent(body, signature, getEnv().STRIPE_WEBHOOK_SECRET);
  } catch {
    log.warn({ code: "invalid_signature" }, "stripe_webhook_rejected");
    return new Response("invalid signature", { status: 400 });
  }

  try {
    const result = await processStripeEvent(event);
    return Response.json({ received: true, outcome: result.outcome });
  } catch (err) {
    log.error({ eventId: event.id, type: event.type, err: safeErr(err) }, "stripe_webhook_failed");
    await sendAlert("webhook_stripe_falhou", { evento: event.id, tipo: event.type });
    return new Response("error", { status: 500 });
  }
}
