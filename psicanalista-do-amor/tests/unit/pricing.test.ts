import { describe, expect, it } from "vitest";
import { grossFromNet, netFromGross, parseBrlToCents } from "@/lib/pricing";

const card = { percent: 3.99, fixedCents: 39 };

describe("repasse da taxa do Stripe", () => {
  it("R$ 10 líquidos → preço cobrado que garante R$ 10 depois da taxa", () => {
    const gross = grossFromNet(1000, card);
    expect(gross).toBe(1083);
    expect(netFromGross(gross, card)).toBeGreaterThanOrEqual(1000);
    expect(netFromGross(gross - 1, card)).toBeLessThan(1000); // é o menor preço possível
  });

  it("R$ 30 líquidos no relatório principal", () => {
    const gross = grossFromNet(3000, card);
    expect(gross).toBe(3166);
    expect(netFromGross(gross, card)).toBeGreaterThanOrEqual(3000);
  });

  it("sem taxa, bruto = líquido; taxa inválida é recusada", () => {
    expect(grossFromNet(1000, { percent: 0, fixedCents: 0 })).toBe(1000);
    expect(() => grossFromNet(1000, { percent: 100, fixedCents: 0 })).toThrow();
  });

  it("vale para vários valores", () => {
    for (let net = 50; net <= 50_000; net += 137) {
      const gross = grossFromNet(net, card);
      expect(netFromGross(gross, card)).toBeGreaterThanOrEqual(net);
      expect(netFromGross(gross - 1, card)).toBeLessThan(net);
    }
  });
});

describe("valor digitado no /admin", () => {
  it("aceita vírgula ou ponto como decimal, sem virar milhar", () => {
    expect(parseBrlToCents("10")).toBe(1000);
    expect(parseBrlToCents("10,5")).toBe(1050);
    expect(parseBrlToCents("10,50")).toBe(1050);
    expect(parseBrlToCents("10.50")).toBe(1050);
    expect(parseBrlToCents(" 30,00 ")).toBe(3000);
  });
  it("recusa formatos ambíguos ou inválidos", () => {
    for (const v of ["1.000,00", "10,505", "abc", "", "-5", "10,", "1e3"]) expect(parseBrlToCents(v)).toBeNull();
  });
});

describe("assinatura mensal (D96)", () => {
  it("R$ 46,99 líquidos → R$ 49,35 por mês; R$ 5 além do limite → R$ 5,62", () => {
    expect(grossFromNet(4699, card)).toBe(4935);
    expect(netFromGross(4935, card)).toBeGreaterThanOrEqual(4699);
    expect(grossFromNet(500, card)).toBe(562);
    expect(netFromGross(562, card)).toBeGreaterThanOrEqual(500);
  });

  it("a tarifa do Stripe Billing entra só no preço da assinatura", async () => {
    const { resetEnvCache, stripeFeesFor } = await import("@/env");
    process.env.STRIPE_SUBSCRIPTION_EXTRA_FEE_PERCENT = "0,7";
    resetEnvCache();
    try {
      const sub = stripeFeesFor("subscription");
      expect(sub.percent).toBeCloseTo(4.69);
      expect(stripeFeesFor("main").percent).toBe(3.99);
      expect(stripeFeesFor("overage").percent).toBe(3.99);
      const gross = grossFromNet(4699, sub);
      expect(gross).toBeGreaterThan(4935);
      // Com a tarifa extra descontada, o líquido continua sendo pelo menos R$ 46,99.
      expect(netFromGross(gross, sub)).toBeGreaterThanOrEqual(4699);
    } finally {
      delete process.env.STRIPE_SUBSCRIPTION_EXTRA_FEE_PERCENT;
      resetEnvCache();
    }
  });
});
