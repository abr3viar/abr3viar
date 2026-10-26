import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

/**
 * Fluxo completo com Groq e Stripe FALSOS:
 * colar conversa → confirmar → relatório parcial (sem vazar conteúdo bloqueado) →
 * pagamento de teste (webhook assinado) → relatório completo.
 */

const conversation = readFileSync("tests/fixtures/e2e-conversation.txt", "utf8");
const LOCKED_MARKERS = ["SEGREDO-BLOQUEADO", "TITULO-REAL-SPOILER"];
// O mock cita a ÚLTIMA mensagem (texto real: o servidor confere as citações) só nas seções
// bloqueadas; as grátis citam a primeira.
const LOCKED_QUOTE = conversation.trim().split("\n").at(-1)!.replace(/^.*? - [^:]+: /, "");

async function submitConversation(page: Page, email: string) {
  await page.goto("/analisar");
  await page.getByRole("textbox", { name: "Conversa" }).fill(conversation);
  await page.getByLabel("Seu e-mail").fill(email);
  for (const box of await page.getByRole("checkbox").all()) await box.check();
  await page.getByRole("button", { name: "Analisar conversa" }).click();
  await page.waitForURL(/\/r\/[0-9a-f-]+\/(processando|confirmar)$/);
  await page.waitForURL(/\/confirmar$/, { timeout: 60_000 });
  const id = /\/r\/([0-9a-f-]+)\//.exec(page.url())![1]!;
  return id;
}

test("colar conversa → parcial → pagamento de teste → relatório completo", async ({ page, browser }) => {
  const id = await submitConversation(page, "marina.e2e@example.com");

  // Confirmação dos participantes
  await expect(page.getByRole("heading", { name: "Quem é quem na conversa?" })).toBeVisible();
  await page.getByRole("radio", { name: /Sou Marina/ }).check();
  await page.getByRole("button", { name: "Confirmar e gerar relatório" }).click();
  await page.waitForURL(new RegExp(`/r/${id}$`), { timeout: 90_000 });

  // Relatório parcial
  await expect(page.getByText("CONTEUDO-LIVRE-retrato")).toBeVisible();
  await expect(page.getByText(/GANCHO-TESTE/)).toBeVisible();
  await expect(page.getByText("O que ninguém percebeu (5)")).toBeVisible();
  await expect(page.getByText("não substitui aconselhamento").first()).toBeVisible();

  // O HTML e o payload RSC NÃO podem conter nada das seções bloqueadas.
  const html = await (await page.request.get(`/r/${id}`)).text();
  const rsc = await (await page.request.get(`/r/${id}`, { headers: { RSC: "1" } })).text();
  for (const body of [html, rsc, await page.content()]) {
    for (const marker of LOCKED_MARKERS) expect(body).not.toContain(marker);
    expect(body).not.toContain(LOCKED_QUOTE);
    expect(body).toContain("CONTEUDO-LIVRE-retrato");
  }
  // Citação inválida (seq inexistente) foi removida no servidor.
  expect(html).not.toContain("citação inválida");

  // Outro navegador (sem sessão) recebe 404 — nunca 403.
  const stranger = await browser.newContext();
  for (const path of [`/r/${id}`, `/r/${id}/processando`, `/r/${id}/confirmar`, `/r/${id}/extra/quem-gosta-mais`]) {
    const res = await stranger.request.get(path);
    expect(res.status(), path).toBe(404);
    expect(await res.text(), path).not.toContain("CONTEUDO-LIVRE");
  }
  await stranger.close();

  // Dois CTAs enquanto bloqueado: depois do gancho e no fim das seções bloqueadas (#desbloquear).
  await expect(page.getByRole("button", { name: /Desbloquear relatório completo/ })).toHaveCount(2);
  await expect(page.locator("#desbloquear")).toHaveCount(1);

  // A URL de retorno não libera nada sozinha.
  await page.goto(`/pagamento/retorno?link=principal&paid=1&session_id=cs_fake`);
  await page.goto(`/r/${id}`);
  expect(await page.content()).not.toContain("SEGREDO-BLOQUEADO");

  // Pagamento (Payment Link simulado → webhook assinado → retorno → relatório completo)
  await page.getByRole("button", { name: /Desbloquear relatório completo/ }).first().click();
  await page.waitForURL(/\/stripe\/pay\/principal/);
  expect(page.url()).toMatch(/client_reference_id=[0-9a-f-]{36}/);
  expect(page.url()).toContain("prefilled_email=marina.e2e%40example.com");
  await page.getByRole("button", { name: "Pagar" }).click();
  await page.waitForURL(new RegExp(`/r/${id}$`), { timeout: 60_000 });

  await expect(page.getByText("SEGREDO-BLOQUEADO-virada")).toBeVisible();
  await expect(page.getByRole("button", { name: /Desbloquear relatório completo/ })).toHaveCount(0);
  await expect(page.getByText("TITULO-REAL-SPOILER-virada")).toBeVisible();
  expect(await page.content()).toContain(`“${LOCKED_QUOTE}”`);
  await expect(page.getByText(/GANCHO-TESTE/)).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Quer ir mais fundo?" })).toBeVisible();

  // Relatório adicional (R$ 10): compra → webhook → job generate_extra → leitura com placar.
  const card = page.locator("article", { hasText: "Quem demonstra mais interesse?" });
  await card.getByRole("button", { name: /Comprar/ }).click();
  await page.waitForURL(/\/stripe\/pay\/quem-gosta-mais/);
  await page.getByRole("button", { name: "Pagar" }).click();
  await page.waitForURL(new RegExp(`/r/${id}/extra/quem-gosta-mais$`), { timeout: 60_000 });
  await expect(page.getByText("CONTEUDO-ADICIONAL-sinais-a")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("Marina demonstra mais interesse")).toBeVisible();
  await expect(page.getByText("Marina — 64%")).toBeVisible();

  // Na vitrine, o adicional comprado vira "Ler relatório".
  await page.goto(`/r/${id}`);
  await expect(page.locator("article", { hasText: "Quem demonstra mais interesse?" }).getByRole("link", { name: "Ler relatório" })).toBeVisible();
});

test("adicional não pode ser comprado antes do principal", async ({ page }) => {
  const id = await submitConversation(page, "sem.principal@example.com");
  await page.getByRole("button", { name: "Confirmar e gerar relatório" }).click();
  await page.waitForURL(new RegExp(`/r/${id}$`), { timeout: 90_000 });
  await expect(page.getByRole("heading", { name: "Quer ir mais fundo?" })).toHaveCount(0);
  await page.goto(`/r/${id}/extra/quem-gosta-mais`);
  await page.waitForURL(new RegExp(`/r/${id}$`));
});
