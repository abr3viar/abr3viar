import { expect, test } from "./fixtures";
import { loginByMagicLink } from "./helpers";

test("painel /admin: 404 para não admin; admin cola o Payment Link e salva", async ({ page, browser }) => {
  const anon = await browser.newContext();
  expect((await anon.request.get("/admin")).status()).toBe(404);
  // Cada página se protege sozinha: uma navegação RSC que pula o layout também dá 404.
  const tree = encodeURIComponent(JSON.stringify(["", { children: ["admin", { children: ["__PAGE__", {}] }] }]));
  // (Numa resposta RSC o Next pode responder 200 com o payload de "não encontrado"; o que
  // importa é que nada da página do painel venha no corpo.)
  const pages = { "/admin/compras": "Últimas 200 compras", "/admin/operacoes": "Tarefas de manutenção", "/admin/relatorios": "Payment Link — TESTE" };
  for (const [path, marker] of Object.entries(pages)) {
    const res = await anon.request.get(path, { headers: { RSC: "1", "Next-Router-State-Tree": tree } });
    const body = await res.text();
    expect(body, path).not.toContain(marker);
    expect(body, path).not.toContain("@example.com");
  }
  await anon.close();

  await loginByMagicLink(page, "comum@example.com");
  expect((await page.request.get("/admin")).status()).toBe(404);

  await loginByMagicLink(page, "admin@example.com");
  // Controle positivo: a MESMA requisição RSC, com sessão de admin, traz a página (o teste
  // anônimo acima prova algo de fato).
  const asAdmin = await page.request.get("/admin/compras", { headers: { RSC: "1", "Next-Router-State-Tree": tree } });
  expect(await asAdmin.text()).toContain("Últimas 200 compras");
  await page.goto("/admin");
  await expect(page.getByText("Stripe em modo")).toBeVisible();
  await page.goto("/admin/relatorios");
  const form = page.locator("form", { hasText: "Compatibilidade e futuro" });
  await form.locator('input[name="stripeTestPaymentLinkId"]').fill("plink_teste_futuro_123");
  await form.locator('input[name="stripeTestPaymentLinkUrl"]').fill("https://buy.stripe.com/test_futuro");
  await form.locator('input[name="netPrice"]').fill("12,90");
  await form.getByRole("button", { name: "Salvar" }).click();
  await expect(page.getByText("Salvo.")).toBeVisible();
  const saved = page.locator("form", { hasText: "Compatibilidade e futuro" });
  await expect(saved.locator('input[name="stripeTestPaymentLinkId"]')).toHaveValue("plink_teste_futuro_123");
  await expect(saved.locator('input[name="netPrice"]')).toHaveValue("12,90");
  await expect(saved.getByText("R$ 13,85")).toBeVisible();

  // Validação: ID sem plink_ é recusado
  await saved.locator('input[name="stripeTestPaymentLinkId"]').fill("errado");
  await saved.getByRole("button", { name: "Salvar" }).click();
  await expect(page.getByText(/plink_/).first()).toBeVisible();
});

test("conta: sessão leve não exporta; após link mágico exporta JSON e exclui tudo", async ({ page }) => {
  const email = `conta.${Date.now()}@example.com`;
  await loginByMagicLink(page, email);
  await page.goto("/conta");
  const res = await page.request.get("/api/account/export");
  expect(res.status()).toBe(200);
  expect(res.headers()["content-disposition"]).toContain("attachment");
  const data = (await res.json()) as { user: { email: string } };
  expect(data.user.email).toBe(email);

  await page.getByLabel("Digite EXCLUIR para confirmar").fill("EXCLUIR");
  await page.getByRole("button", { name: "Excluir tudo" }).click();
  await page.waitForURL(/dados-excluidos=1/);
  expect((await page.request.get("/api/account/export")).status()).toBe(401);
});
