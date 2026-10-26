import "server-only";
import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, notInArray, or, sql } from "drizzle-orm";
import type Stripe from "stripe";
import { getEnv, isStripeLiveMode } from "@/env";
import { SUBSCRIPTION_DAILY_LIMIT, SUBSCRIPTION_TIMEZONE } from "@/lib/subscription";
import type { SubscriptionStateView } from "@/lib/views";
import type { Viewer } from "@/server/auth/session";
import { getDb, type Db, type Tx } from "@/server/db/client";
import { auditLog, subscriptionUnlocks, subscriptions, type Subscription } from "@/server/db/schema";
import { log, safeErr } from "@/server/log";
import { getStripe } from "./stripe";

/**
 * Assinatura mensal (D96): leitura do estado e sincronização com o Stripe.
 *
 * O estado da assinatura só é gravado a partir de dados do Stripe conferidos: eventos do
 * webhook (assinatura validada) ou a API autenticada (reconciliação). A liberação de
 * relatórios pela assinatura fica em fulfill.ts (único módulo que escreve `is_unlocked`).
 */

type Conn = Db | Tx;

/** Status do Stripe que dão direito ao uso. `past_due` (cobrança falhou) não dá. */
export const ENTITLED_STATUSES = ["active", "trialing"] as const;
/** Status finais: a assinatura não volta a cobrar nem a dar acesso. */
export const FINAL_STATUSES = ["canceled", "incomplete_expired"] as const;

/**
 * Desempate de eventos com o mesmo `created` (resolução de 1 s): fica o status "mais adiante"
 * no ciclo de vida. Ex.: `created` (incomplete) e `updated` (active) do mesmo checkout.
 * Qualquer desempate errado é corrigido pelo job `subscription_sync` (relê a API).
 */
const STATUS_RANK: Record<string, number> = {
  incomplete: 0,
  trialing: 1,
  active: 1,
  past_due: 2,
  unpaid: 2,
  paused: 2,
  canceled: 3,
  incomplete_expired: 3,
};
const rankOf = (status: string) => STATUS_RANK[status] ?? 1;
/** Sem a data do fim do período (evento da assinatura ainda não chegou), vale por no máximo 2 dias. */
const UNKNOWN_PERIOD_GRACE_MS = 2 * 86_400_000;

/** Dia do limite diário, no horário de Brasília (renova à meia-noite). */
export const todaySql = sql<string>`(now() AT TIME ZONE ${SUBSCRIPTION_TIMEZONE})::date`;

function entitledWhere(userId: string, live: boolean) {
  return and(
    eq(subscriptions.userId, userId),
    inArray(subscriptions.status, [...ENTITLED_STATUSES]),
    isNull(subscriptions.revokedAt),
    eq(subscriptions.livemode, live),
    or(
      gt(subscriptions.currentPeriodEnd, sql`now()`),
      and(isNull(subscriptions.currentPeriodEnd), gt(subscriptions.createdAt, new Date(Date.now() - UNKNOWN_PERIOD_GRACE_MS))),
    ),
  );
}

/** Assinatura que dá direito ao uso agora (no modo atual do Stripe), ou null. */
export async function findActiveSubscription(conn: Conn, userId: string, opts: { lock?: boolean } = {}): Promise<Subscription | null> {
  const query = conn
    .select()
    .from(subscriptions)
    .where(entitledWhere(userId, isStripeLiveMode()))
    .orderBy(desc(subscriptions.createdAt))
    .limit(1);
  // FOR SHARE: uma revogação/cancelamento simultâneo espera este uso terminar (ou o exclui).
  const [row] = opts.lock ? await query.for("share") : await query;
  return row ?? null;
}

/** Relatórios completos liberados hoje pela assinatura (os adicionais não contam). */
export async function usedToday(conn: Conn, userId: string): Promise<number> {
  const [row] = await conn
    .select({ n: sql<number>`count(*)::int` })
    .from(subscriptionUnlocks)
    .where(and(eq(subscriptionUnlocks.userId, userId), eq(subscriptionUnlocks.counts, true), eq(subscriptionUnlocks.day, todaySql)));
  return row?.n ?? 0;
}

/**
 * Estado da assinatura para as telas. SÓ para sessão verificada pelo link do e-mail:
 * uma sessão criada no envio (e-mail digitado, não confirmado) não usa nem enxerga a
 * assinatura daquele e-mail (D96).
 */
export async function subscriptionStateFor(viewer: Viewer | null): Promise<SubscriptionStateView | null> {
  if (!viewer?.verified) return null;
  const db = getDb();
  const active = await findActiveSubscription(db, viewer.userId);
  const latest =
    active ??
    (
      await db
        .select()
        .from(subscriptions)
        .where(and(eq(subscriptions.userId, viewer.userId), eq(subscriptions.livemode, isStripeLiveMode())))
        .orderBy(desc(subscriptions.createdAt))
        .limit(1)
    )[0];
  if (!latest) return null;
  const used = active ? await usedToday(db, viewer.userId) : 0;
  return {
    active: Boolean(active),
    status: latest.revokedAt ? "revoked" : latest.status,
    currentPeriodEnd: latest.currentPeriodEnd ? latest.currentPeriodEnd.toISOString() : null,
    cancelAtPeriodEnd: latest.cancelAtPeriodEnd,
    usedToday: used,
    dailyLimit: SUBSCRIPTION_DAILY_LIMIT,
    remainingToday: Math.max(0, SUBSCRIPTION_DAILY_LIMIT - used),
  };
}

function idOf(value: string | { id: string } | null | undefined): string | null {
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
}

/** Fim do período atual (na API atual do Stripe, fica nos itens da assinatura). */
export function periodEndOf(sub: Stripe.Subscription): Date | null {
  const ends = (sub.items?.data ?? []).map((i) => i.current_period_end).filter((n): n is number => typeof n === "number");
  return ends.length ? new Date(Math.max(...ends) * 1000) : null;
}

/**
 * Aplica o estado de uma assinatura vinda do Stripe.
 * - `eventAt` (evento do webhook): eventos mais antigos que o último aplicado são ignorados;
 *   empate no mesmo segundo usa STATUS_RANK.
 * - `eventAt = null` (leitura da API): é o estado atual; aplica sem mexer em `lastEventAt`,
 *   para não descartar eventos posteriores do mesmo segundo.
 * Assinatura desconhecida (o evento chegou antes do checkout) fica sem dono até o
 * `checkout.session.completed` ligar a conta.
 */
export async function applySubscriptionState(tx: Tx, sub: Stripe.Subscription, eventAt: Date | null): Promise<"applied" | "stale"> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`sub:${sub.id}`}))`);
  const [current] = await tx.select().from(subscriptions).where(eq(subscriptions.stripeSubscriptionId, sub.id)).for("update");
  if (eventAt && current?.lastEventAt) {
    const diff = current.lastEventAt.getTime() - eventAt.getTime();
    if (diff > 0) return "stale";
    if (diff === 0 && rankOf(sub.status) < rankOf(current.status)) return "stale";
  }
  const values = {
    status: sub.status,
    stripeCustomerId: idOf(sub.customer),
    livemode: sub.livemode,
    currentPeriodEnd: periodEndOf(sub),
    cancelAtPeriodEnd: sub.cancel_at_period_end,
    ...(eventAt ? { lastEventAt: eventAt } : {}),
    syncedAt: new Date(),
  };
  if (current) {
    await tx.update(subscriptions).set(values).where(eq(subscriptions.id, current.id));
    if (current.status !== sub.status) {
      await tx.insert(auditLog).values({
        userId: current.userId,
        action: "subscription.status_changed",
        targetId: current.id,
        meta: { from: current.status, to: sub.status },
      });
    }
  } else {
    await tx.insert(subscriptions).values({ stripeSubscriptionId: sub.id, lastEventAt: eventAt, ...values });
  }
  log.info({ subscriptionId: sub.id, status: sub.status }, "subscription_synced");
  return "applied";
}

/** Busca a assinatura na API autenticada do Stripe (injetável nos testes). */
export type SubscriptionRetriever = (stripeSubscriptionId: string) => Promise<Stripe.Subscription>;
const defaultRetriever: SubscriptionRetriever = (id) => getStripe().subscriptions.retrieve(id);

/** Relê uma assinatura na API e aplica (job `subscription_sync`). */
export async function syncSubscriptionFromStripe(stripeSubscriptionId: string, retrieve: SubscriptionRetriever = defaultRetriever): Promise<void> {
  const sub = await retrieve(stripeSubscriptionId);
  await getDb().transaction((tx) => applySubscriptionState(tx, sub, null));
}

/** Cancela na hora no Stripe (já cancelada/inexistente conta como feito) e grava o estado. */
export async function cancelStripeSubscription(
  stripeSubscriptionId: string,
  cancel: (id: string) => Promise<unknown> = (id) => getStripe().subscriptions.cancel(id),
  retrieve: SubscriptionRetriever = defaultRetriever,
): Promise<void> {
  try {
    await cancel(stripeSubscriptionId);
  } catch (err) {
    if ((err as { code?: string }).code !== "resource_missing") {
      // Já cancelada no Stripe (o erro varia): confere o estado antes de dar como falha.
      const current = await retrieve(stripeSubscriptionId).catch(() => null);
      if (!current || !(FINAL_STATUSES as readonly string[]).includes(current.status)) throw err;
    }
  }
  await getDb()
    .update(subscriptions)
    .set({ status: "canceled", cancelAtPeriodEnd: false, syncedAt: new Date() })
    .where(eq(subscriptions.stripeSubscriptionId, stripeSubscriptionId));
}

/** Assinatura ainda aberta no Stripe (pode voltar a cobrar), com ou sem direito ao uso. */
export async function findOpenSubscription(conn: Conn, userId: string): Promise<Subscription | null> {
  const [row] = await conn
    .select()
    .from(subscriptions)
    .where(and(eq(subscriptions.userId, userId), eq(subscriptions.livemode, isStripeLiveMode()), notInArray(subscriptions.status, [...FINAL_STATUSES])))
    .orderBy(desc(subscriptions.createdAt))
    .limit(1);
  return row ?? null;
}

/**
 * Reconciliação: reconfere no Stripe as assinaturas ainda não encerradas que não foram
 * sincronizadas nas últimas 12 h (cobre eventos perdidos de renovação ou cancelamento).
 */
export async function syncOpenSubscriptions(retrieve: SubscriptionRetriever = defaultRetriever): Promise<{ checked: number; failed: number }> {
  const db = getDb();
  const stale = await db
    .select({ stripeSubscriptionId: subscriptions.stripeSubscriptionId })
    .from(subscriptions)
    .where(
      and(
        isNotNull(subscriptions.userId),
        notInArray(subscriptions.status, [...FINAL_STATUSES]),
        or(isNull(subscriptions.syncedAt), sql`${subscriptions.syncedAt} < now() - interval '12 hours'`),
      ),
    )
    .orderBy(sql`${subscriptions.syncedAt} ASC NULLS FIRST`, asc(subscriptions.createdAt))
    .limit(200);
  let failed = 0;
  for (const row of stale) {
    try {
      const sub = await retrieve(row.stripeSubscriptionId);
      // A leitura da API é o estado atual (não mexe na ordem dos eventos).
      await db.transaction((tx) => applySubscriptionState(tx, sub, null));
    } catch (err) {
      failed++;
      log.warn({ subscriptionId: row.stripeSubscriptionId, err: safeErr(err) }, "subscription_sync_failed");
    }
  }
  return { checked: stale.length, failed };
}

/** Cancela no Stripe, na hora, as assinaturas ainda abertas do usuário (exclusão da conta). */
export async function cancelUserSubscriptions(
  userId: string,
  cancel: (stripeSubscriptionId: string) => Promise<unknown> = (id) => getStripe().subscriptions.cancel(id),
): Promise<{ ok: boolean }> {
  const open = await getDb()
    .select()
    .from(subscriptions)
    .where(and(eq(subscriptions.userId, userId), notInArray(subscriptions.status, [...FINAL_STATUSES])));
  for (const s of open) {
    try {
      await cancel(s.stripeSubscriptionId);
      await getDb().update(subscriptions).set({ status: "canceled", cancelAtPeriodEnd: false, syncedAt: new Date() }).where(eq(subscriptions.id, s.id));
      await getDb().insert(auditLog).values({ userId, action: "subscription.canceled_account_deletion", targetId: s.id });
    } catch (err) {
      const code = (err as { code?: string }).code;
      // Já cancelada/inexistente no Stripe: nada mais a cobrar.
      if (code === "resource_missing") {
        await getDb().update(subscriptions).set({ status: "canceled", syncedAt: new Date() }).where(eq(subscriptions.id, s.id));
        continue;
      }
      log.error({ subscriptionId: s.id, err: safeErr(err) }, "subscription_cancel_failed");
      return { ok: false };
    }
  }
  return { ok: true };
}

/** Sessão do portal do cliente do Stripe (gerenciar cartão, ver faturas e cancelar). */
export async function billingPortalUrl(userId: string): Promise<string | null> {
  const [row] = await getDb()
    .select({ customer: subscriptions.stripeCustomerId })
    .from(subscriptions)
    .where(and(eq(subscriptions.userId, userId), eq(subscriptions.livemode, isStripeLiveMode()), sql`${subscriptions.stripeCustomerId} IS NOT NULL`))
    .orderBy(desc(subscriptions.createdAt))
    .limit(1);
  if (!row?.customer) return null;
  try {
    const session = await getStripe().billingPortal.sessions.create({
      customer: row.customer,
      return_url: `${getEnv().APP_URL.replace(/\/+$/, "")}/conta`,
      locale: "pt-BR",
    });
    return session.url;
  } catch (err) {
    log.error({ err: safeErr(err) }, "billing_portal_failed");
    return null;
  }
}
