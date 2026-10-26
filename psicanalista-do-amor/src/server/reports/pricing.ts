import "server-only";
import { asc, eq } from "drizzle-orm";
import { stripeFees } from "@/env";
import { grossFromNet } from "@/lib/pricing";
import { getDb } from "@/server/db/client";
import { reportTypes } from "@/server/db/schema";
import { SUBSCRIPTION_DAILY_LIMIT } from "@/lib/subscription";
import type { SubscriptionOfferView } from "@/lib/views";
import { MAIN_REPORT_SLUG, OVERAGE_SLUG, SUBSCRIPTION_SLUG } from "./catalog";
import { paymentLinkFor } from "./get-report-view";

/**
 * Preços exibidos ao público: sempre o valor COBRADO (bruto = líquido + taxa do Stripe),
 * lido do banco (o painel /admin é a fonte). Sem banco, calcula a partir do líquido padrão.
 */
type PublicPrices = {
  mainCents: number;
  extraFromCents: number | null;
  extraUniform: boolean;
  currency: string;
  /** Assinatura mensal (D96), se estiver à venda; e o relatório além do limite diário. */
  subscriptionCents: number | null;
  overageCents: number | null;
};

// Cache em memória por processo (60 s): o preço não é dado do usuário e não muda a cada
// visita; evita segurar o HTML da landing esperando o banco (SEO-11). O /admin limpa ao salvar
// (no processo que atendeu; com várias instâncias, as outras atualizam em até 60 s).
const CACHE_MS = 60_000;
const holder = globalThis as unknown as { __pdaPrices?: { at: number; value: PublicPrices } };

export function clearPublicPricesCache(): void {
  holder.__pdaPrices = undefined;
}

export async function publicPrices(): Promise<PublicPrices> {
  const hit = holder.__pdaPrices;
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  const { value, fromDb } = await loadPublicPrices();
  // O cálculo de reserva (banco fora) não é guardado: na próxima visita tenta o banco de novo.
  if (fromDb) holder.__pdaPrices = { at: Date.now(), value };
  return value;
}

async function loadPublicPrices(): Promise<{ value: PublicPrices; fromDb: boolean }> {
  const fallback = (): { value: PublicPrices; fromDb: boolean } => {
    let fees = { percent: 3.99, fixedCents: 39 };
    try {
      fees = stripeFees();
    } catch {
      // env inválido: taxa padrão
    }
    return {
      value: {
        mainCents: grossFromNet(3000, fees),
        extraFromCents: grossFromNet(1000, fees),
        extraUniform: true,
        currency: "brl",
        // Sem banco não dá para saber se a assinatura está à venda: não anuncia.
        subscriptionCents: null,
        overageCents: null,
      },
      fromDb: false,
    };
  };
  try {
    const rows = await getDb().select().from(reportTypes).where(eq(reportTypes.isActive, true)).orderBy(asc(reportTypes.priceCents));
    const main = rows.find((r) => r.slug === MAIN_REPORT_SLUG);
    const extras = rows.filter((r) => r.kind === "extra");
    const sub = rows.find((r) => r.slug === SUBSCRIPTION_SLUG && r.kind === "subscription");
    const overage = rows.find((r) => r.slug === OVERAGE_SLUG && r.kind === "overage");
    if (!main) return fallback();
    return {
      value: {
        mainCents: main.priceCents,
        extraFromCents: extras[0]?.priceCents ?? null,
        // Todos os adicionais ativos com o mesmo preço? (senão, o texto diz "a partir de")
        extraUniform: extras.every((e) => e.priceCents === extras[0]!.priceCents),
        currency: main.currency,
        // Só anuncia a assinatura com o Payment Link do modo atual configurado.
        subscriptionCents: sub && paymentLinkFor(sub) ? sub.priceCents : null,
        overageCents: sub && paymentLinkFor(sub) && overage ? overage.priceCents : null,
      },
      fromDb: true,
    };
  } catch {
    return fallback();
  }
}

/**
 * Oferta da assinatura para as telas de compra (sem cache: precisa do Payment Link atual).
 * Null quando a assinatura não está à venda (desativada no /admin).
 */
export async function getSubscriptionOffer(): Promise<SubscriptionOfferView | null> {
  const rows = await getDb().select().from(reportTypes).where(eq(reportTypes.isActive, true));
  const sub = rows.find((r) => r.slug === SUBSCRIPTION_SLUG && r.kind === "subscription");
  if (!sub) return null;
  const overage = rows.find((r) => r.slug === OVERAGE_SLUG && r.kind === "overage");
  return {
    priceCents: sub.priceCents,
    overagePriceCents: overage?.priceCents ?? null,
    currency: sub.currency,
    dailyLimit: SUBSCRIPTION_DAILY_LIMIT,
    purchasable: paymentLinkFor(sub) !== null,
    overagePurchasable: overage ? paymentLinkFor(overage) !== null : false,
  };
}
