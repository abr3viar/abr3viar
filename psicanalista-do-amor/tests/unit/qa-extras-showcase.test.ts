import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ExtrasShowcase } from "@/components/report/extras-showcase";
import { CheckoutButton } from "@/components/report/checkout-button";
import type { ExtraOfferView } from "@/lib/views";

/** Vitrine de adicionais: "Em breve" sem link, pedido de "quem é você" e estados. */

const noop = async () => undefined;

function offer(overrides: Partial<ExtraOfferView>): ExtraOfferView {
  return {
    slug: "quem-gosta-mais",
    name: "Quem demonstra mais interesse?",
    teaser: "Teaser fictício",
    description: "Descrição fictícia",
    priceCents: 1083,
    currency: "brl",
    purchasable: true,
    state: "available",
    reportId: null,
    blockedReason: null,
    ...overrides,
  };
}

function render(offers: ExtraOfferView[]): string {
  return renderToStaticMarkup(
    createElement(ExtrasShowcase, {
      conversationId: "0190a0a0-0000-7000-8000-000000000001",
      offers,
      action: noop,
      setUserSideAction: noop,
      names: { a: "Ana", b: "Lucas" },
    }),
  );
}

describe("vitrine de adicionais", () => {
  it("sem Payment Link: botão desabilitado com 'Em breve' e nenhum link de pagamento", () => {
    const html = render([offer({ purchasable: false })]);
    expect(html).toContain("Em breve.");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Comprar — R\$\s?10,83<\/button>/);
    expect(html).not.toContain("stripe.com");
    expect(html).not.toContain("href=\"/r/");
  });

  it("com Payment Link: botão habilitado e sem 'Em breve'", () => {
    const html = render([offer({ purchasable: true })]);
    expect(html).not.toContain("Em breve");
    expect(html).not.toMatch(/<button[^>]*disabled/);
  });

  it("requiresUserSide sem lado definido: pede 'quem é você' e não oferece compra", () => {
    const html = render([offer({ slug: "como-responder", name: "Como responder a última mensagem", blockedReason: "needs_user_side" })]);
    expect(html).toContain("Sou Ana");
    expect(html).toContain("Sou Lucas");
    expect(html).not.toContain("Comprar");
  });

  it("adicional já comprado vira link de leitura/acompanhamento (sem nova compra)", () => {
    const html = render([offer({ state: "ready", reportId: "r1" }), offer({ slug: "red-flags", name: "Red flags", state: "generating", reportId: "r2" })]);
    expect(html).toContain("Ler relatório");
    expect(html).toContain("Acompanhar geração");
    expect(html).not.toContain("Comprar");
  });

  it("vitrine vazia não renderiza nada", () => {
    expect(render([])).toBe("");
  });

  it("CheckoutButton sem link: desabilitado e com aviso amigável", () => {
    const html = renderToStaticMarkup(
      createElement(CheckoutButton, { conversationId: "c", slug: "principal", priceCents: 3166, currency: "brl", purchasable: false, label: "Desbloquear", action: noop }),
    );
    expect(html).toMatch(/<button[^>]*disabled/);
    expect(html).toContain("O pagamento ainda não está disponível");
  });
});
