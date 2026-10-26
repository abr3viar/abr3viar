import { expect, test } from "./fixtures";
import { confirmAndWaitReport, loginByMagicLink, submitPastedConversation } from "./helpers";

/**
 * Assinatura mensal (D96): assinar (Payment Link simulado → webhook assinado), liberar o
 * relatório completo pela assinatura e gerar um adicional incluído, sem nova cobrança.
 */
test("assinatura: assina, libera o relatório pela cota do dia e gera adicional incluído", async ({ page }) => {
  const email = `assinante.${Date.now()}@example.com`;
  const id = await submitPastedConversation(page, email);
  await confirmAndWaitReport(page, id);

  // Sessão do envio (não verificada): só a compra avulsa + convite para entrar; nada da assinatura.
  await expect(page.getByRole("button", { name: /Desbloquear relatório completo/ })).toHaveCount(2);
  await expect(page.getByText("Já é assinante?").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Ver o relatório completo" })).toHaveCount(0);

  // Página pública da assinatura: pede o login pelo e-mail antes de assinar.
  await page.goto("/assinatura");
  await expect(page.getByText(/49,35/).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Entrar para assinar" })).toBeVisible();

  await loginByMagicLink(page, email);
  await page.goto("/assinatura");
  await page.getByRole("button", { name: /Assinar por/ }).click();
  await page.waitForURL(/\/stripe\/pay\/assinatura-mensal/);
  expect(page.url()).toMatch(/client_reference_id=[0-9a-f-]{36}/);
  await page.getByRole("button", { name: "Pagar" }).click();
  await page.waitForURL(/\/pagamento\/retorno\?link=assinatura-mensal/);
  await expect(page.getByRole("heading", { name: "Assinatura ativa" })).toBeVisible({ timeout: 30_000 });

  // Relatório: libera pela assinatura (sem Payment Link), contando 1 no dia.
  await page.goto(`/r/${id}`);
  expect(await page.content()).not.toContain("SEGREDO-BLOQUEADO");
  await expect(page.getByText(/restam 10 relatórios/).first()).toBeVisible();
  await page.getByRole("button", { name: "Ver o relatório completo" }).first().click();
  await page.waitForURL(new RegExp(`/r/${id}$`));
  await expect(page.getByText("SEGREDO-BLOQUEADO-virada")).toBeVisible();
  await expect(page.getByRole("button", { name: /Desbloquear relatório completo/ })).toHaveCount(0);

  // Adicional incluído: gera sem passar pelo pagamento.
  const card = page.locator("article", { hasText: "Quem demonstra mais interesse?" });
  await card.getByRole("button", { name: "Gerar relatório (incluído)" }).click();
  await page.waitForURL(new RegExp(`/r/${id}/extra/quem-gosta-mais$`));
  await expect(page.getByText("CONTEUDO-ADICIONAL-sinais-a")).toBeVisible({ timeout: 60_000 });

  // Minha conta mostra a assinatura e o uso do dia.
  await page.goto("/conta");
  await expect(page.getByText(/^Ativa\./)).toBeVisible();
  await expect(page.getByText("Hoje: 1 de 10 relatórios completos usados", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Gerenciar ou cancelar a assinatura" })).toBeVisible();
});
