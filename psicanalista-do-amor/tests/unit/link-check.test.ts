import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetEnvCache } from "@/env";
import { checkPaymentLinkPrice } from "@/server/payments/link-check";

type Item = { price: { currency: string; unit_amount: number | null; custom_unit_amount?: unknown; type?: string; recurring?: unknown } | null; quantity: number; amount_total: number; adjustable_quantity?: { enabled: boolean } | null };
const holder = globalThis as unknown as { __pdaStripe?: unknown };

function fakeStripe(link: Record<string, unknown>, items: Item[]) {
  holder.__pdaStripe = {
    paymentLinks: {
      retrieve: async () => ({
        allow_promotion_codes: false,
        optional_items: [],
        active: true,
        url: "https://buy.stripe.com/x",
        automatic_tax: { enabled: false },
        shipping_options: [],
        after_completion: { type: "redirect", redirect: { url: `${process.env.APP_URL}/pagamento/retorno?link=principal` } },
        ...link,
      }),
      listLineItems: async () => ({ data: items }),
    },
  };
}
const item = (over: Partial<Item> = {}): Item => ({ price: { currency: "brl", unit_amount: 1083, type: "one_time" }, quantity: 1, amount_total: 1083, adjustable_quantity: null, ...over });

describe("conferência do Payment Link no Stripe", () => {
  const original = process.env.STRIPE_SECRET_KEY;
  beforeEach(() => {
    process.env.STRIPE_SECRET_KEY = "sk_test_conferencia";
    resetEnvCache();
  });
  afterEach(() => {
    process.env.STRIPE_SECRET_KEY = original;
    resetEnvCache();
    holder.__pdaStripe = undefined;
  });

  it("aceita só o preço EXATO, em BRL, quantidade fixa 1", async () => {
    fakeStripe({}, [item()]);
    expect(await checkPaymentLinkPrice("plink_x", 1083)).toEqual({ ok: true });
    expect(await checkPaymentLinkPrice("plink_x", 1000)).toMatchObject({ ok: false, reason: "price_mismatch", linkCents: 1083 });
    expect(await checkPaymentLinkPrice("plink_x", 1200)).toMatchObject({ ok: false, reason: "price_mismatch" });
  });

  it("recusa moeda errada, valor livre, cupom, itens opcionais, vários produtos e quantidade ajustável", async () => {
    fakeStripe({}, [item({ price: { currency: "usd", unit_amount: 1083 } })]);
    expect(await checkPaymentLinkPrice("plink_x", 1083)).toMatchObject({ reason: "currency_mismatch" });
    fakeStripe({}, [item({ price: { currency: "brl", unit_amount: null, custom_unit_amount: { minimum: 100 } } })]);
    expect(await checkPaymentLinkPrice("plink_x", 1083)).toMatchObject({ reason: "custom_amount" });
    fakeStripe({ allow_promotion_codes: true }, [item()]);
    expect(await checkPaymentLinkPrice("plink_x", 1083)).toMatchObject({ reason: "link_options" });
    fakeStripe({ optional_items: [{}] }, [item()]);
    expect(await checkPaymentLinkPrice("plink_x", 1083)).toMatchObject({ reason: "link_options" });
    fakeStripe({}, [item(), item()]);
    expect(await checkPaymentLinkPrice("plink_x", 1083)).toMatchObject({ reason: "link_options" });
    fakeStripe({}, [item({ adjustable_quantity: { enabled: true } })]);
    expect(await checkPaymentLinkPrice("plink_x", 1083)).toMatchObject({ reason: "link_options" });
  });

  it("recusa assinatura (preço recorrente), link desativado e URL de outro link", async () => {
    fakeStripe({}, [item({ price: { currency: "brl", unit_amount: 1083, type: "recurring", recurring: { interval: "month" } } })]);
    expect(await checkPaymentLinkPrice("plink_x", 1083)).toMatchObject({ reason: "link_options" });
    fakeStripe({ active: false }, [item()]);
    expect(await checkPaymentLinkPrice("plink_x", 1083)).toMatchObject({ reason: "not_found" });
    fakeStripe({ url: "https://buy.stripe.com/x" }, [item()]);
    expect(await checkPaymentLinkPrice("plink_x", 1083, "https://buy.stripe.com/outro")).toMatchObject({ reason: "url_mismatch" });
    expect(await checkPaymentLinkPrice("plink_x", 1083, "https://buy.stripe.com/x/")).toEqual({ ok: true });
  });

  it("assinatura (D96): exige preço recorrente mensal, sem teste grátis", async () => {
    const monthly = { currency: "brl", unit_amount: 4935, type: "recurring", recurring: { interval: "month", interval_count: 1 } };
    fakeStripe({}, [item({ price: monthly })]);
    expect(await checkPaymentLinkPrice("plink_x", 4935, null, "monthly")).toEqual({ ok: true });
    expect(await checkPaymentLinkPrice("plink_x", 4900, null, "monthly")).toMatchObject({ reason: "price_mismatch" });
    fakeStripe({}, [item({ price: { currency: "brl", unit_amount: 4935, type: "one_time" } })]);
    expect(await checkPaymentLinkPrice("plink_x", 4935, null, "monthly")).toMatchObject({ reason: "billing_mismatch" });
    fakeStripe({}, [item({ price: { ...monthly, recurring: { interval: "year", interval_count: 1 } } })]);
    expect(await checkPaymentLinkPrice("plink_x", 4935, null, "monthly")).toMatchObject({ reason: "billing_mismatch" });
    fakeStripe({}, [item({ price: { ...monthly, recurring: { interval: "month", interval_count: 3 } } })]);
    expect(await checkPaymentLinkPrice("plink_x", 4935, null, "monthly")).toMatchObject({ reason: "billing_mismatch" });
    fakeStripe({ subscription_data: { trial_period_days: 7 } }, [item({ price: monthly })]);
    expect(await checkPaymentLinkPrice("plink_x", 4935, null, "monthly")).toMatchObject({ reason: "billing_mismatch" });
  });

  it("assinatura e além do limite: o redirect precisa trazer ?link=<slug>", async () => {
    fakeStripe({ after_completion: { type: "redirect", redirect: { url: `${process.env.APP_URL}/pagamento/retorno?link=assinatura-mensal` } } }, [item()]);
    expect(await checkPaymentLinkPrice("plink_x", 1083, null, "one_time", "assinatura-mensal")).toEqual({ ok: true });
    expect(await checkPaymentLinkPrice("plink_x", 1083, null, "one_time", "relatorio-alem-do-limite")).toMatchObject({ reason: "redirect_mismatch" });
    fakeStripe({ after_completion: { type: "redirect", redirect: { url: `${process.env.APP_URL}/pagamento/retorno` } } }, [item()]);
    expect(await checkPaymentLinkPrice("plink_x", 1083, null, "one_time", "assinatura-mensal")).toMatchObject({ reason: "redirect_mismatch" });
  });

  it("recusa imposto automático, frete e redirect que não volta ao site", async () => {
    fakeStripe({ automatic_tax: { enabled: true } }, [item()]);
    expect(await checkPaymentLinkPrice("plink_x", 1083)).toMatchObject({ reason: "link_options" });
    fakeStripe({ shipping_options: [{}] }, [item()]);
    expect(await checkPaymentLinkPrice("plink_x", 1083)).toMatchObject({ reason: "link_options" });
    fakeStripe({ after_completion: { type: "hosted_confirmation" } }, [item()]);
    expect(await checkPaymentLinkPrice("plink_x", 1083)).toMatchObject({ reason: "redirect_mismatch" });
    fakeStripe({ after_completion: { type: "redirect", redirect: { url: "https://outro-site.com/pagamento/retorno" } } }, [item()]);
    expect(await checkPaymentLinkPrice("plink_x", 1083)).toMatchObject({ reason: "redirect_mismatch" });
  });

  it("Stripe fora do ar → unavailable; 404 → not_found", async () => {
    holder.__pdaStripe = { paymentLinks: { retrieve: async () => { throw Object.assign(new Error("x"), { statusCode: 503 }); } } };
    expect(await checkPaymentLinkPrice("plink_x", 1083)).toMatchObject({ reason: "unavailable" });
    holder.__pdaStripe = { paymentLinks: { retrieve: async () => { throw Object.assign(new Error("x"), { statusCode: 404 }); } } };
    expect(await checkPaymentLinkPrice("plink_x", 1083)).toMatchObject({ reason: "not_found" });
  });
});
