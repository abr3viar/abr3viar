import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { confirmAndWaitReport, payMainReport, submitPastedConversation } from "./helpers";
import { fakeScreenshot } from "../helpers/images";

/**
 * Auditoria de QA (etapa 2): fluxos de envio, falha/"tentar de novo", exclusão, adicionais
 * e retorno do pagamento. Cada teste com ID (QA-xx) reproduzia um bug do relatório de QA e
 * hoje passa com a correção.
 */

async function acceptAndSubmit(page: Page, email: string) {
  await page.getByLabel("Seu e-mail").fill(email);
  for (const box of await page.getByRole("checkbox").all()) await box.check();
  await page.getByRole("button", { name: "Analisar conversa" }).click();
}

// (Antes mostrava "Tentar de novo" mesmo sem os arquivos — QA-01; agora oferece reenviar.)
test("envio: texto que não é conversa falha com mensagem amigável e oferece enviar outra", async ({ page }) => {
  await page.goto("/analisar");
  await page.getByRole("radio", { name: "Arquivo .txt" }).click();
  await page.locator('input[type="file"]').setInputFiles({ name: "nota.txt", mimeType: "text/plain", buffer: readFileSync("tests/fixtures/not-a-chat.txt") });
  await acceptAndSubmit(page, `formato.${Date.now()}@example.com`);
  await page.waitForURL(/\/processando$/);
  await expect(page.getByRole("heading", { name: "Não conseguimos concluir" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Não reconhecemos o formato da conversa")).toBeVisible();
  await expect(page.getByRole("link", { name: "Enviar outra conversa" })).toBeVisible();
});

// QA-01: depois de uma falha PERMANENTE (formato não reconhecido) os originais já foram
// apagados; "Tentar de novo" redireciona para /analisar?erro=files_missing, mas a página
// /analisar ignora `erro` e o usuário cai num formulário vazio, sem explicação.
test("QA-01: falha permanente explica o que aconteceu e leva a um novo envio", async ({ page }) => {
  await page.goto("/analisar");
  await page.getByRole("radio", { name: "Arquivo .txt" }).click();
  await page.locator('input[type="file"]').setInputFiles({ name: "nota.txt", mimeType: "text/plain", buffer: readFileSync("tests/fixtures/not-a-chat.txt") });
  await acceptAndSubmit(page, `retry.${Date.now()}@example.com`);
  await page.waitForURL(/\/processando$/);
  await expect(page.getByText(/os arquivos enviados já foram apagados/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Tentar de novo" })).toHaveCount(0);
  await page.getByRole("link", { name: "Enviar outra conversa" }).click();
  await page.waitForURL(/\/analisar/);
  // E o caminho antigo (?erro=files_missing) também explica.
  await page.goto("/analisar?erro=files_missing");
  await expect(page.getByText("Os arquivos originais já foram apagados")).toBeVisible();
});

// QA-02: o limite de envios (5/h por IP e por e-mail) é consumido ANTES de validar o arquivo.
// Quem erra de aba ou de arquivo 5 vezes fica 1 hora sem conseguir enviar a conversa certa.
test("QA-02: envios recusados na validação não gastam o limite de envios", async ({ page }) => {
  const email = `limite.${Date.now()}@example.com`;
  const png = await fakeScreenshot();
  await page.goto("/analisar");
  for (let i = 0; i < 5; i++) {
    await page.getByRole("radio", { name: "Arquivo .txt" }).click();
    await page.locator('input[type="file"]').setInputFiles({ name: "conversa.txt", mimeType: "text/plain", buffer: png });
    await acceptAndSubmit(page, email);
    await expect(page.locator("#upload-error")).toContainText("não é aceito");
  }
  await page.getByRole("radio", { name: "Colar texto" }).click();
  await page.getByRole("textbox", { name: "Conversa" }).fill(readFileSync("tests/fixtures/e2e-conversation.txt", "utf8"));
  await page.getByRole("button", { name: "Analisar conversa" }).click();
  await page.waitForURL(/\/r\/[0-9a-f-]+\/(processando|confirmar)$/, { timeout: 20_000 });
});

// QA-03: "Excluir esta análise" apaga de forma IRREVERSÍVEL (inclusive relatório pago) com
// um único clique, sem confirmação. O botão fica logo abaixo do conteúdo, no rodapé.
test("QA-03: excluir uma análise pede confirmação antes de apagar", async ({ page }) => {
  const id = await submitPastedConversation(page, `excluir.${Date.now()}@example.com`);
  await confirmAndWaitReport(page, id);
  // O primeiro toque só abre o aviso; nada é apagado.
  await page.getByText("Excluir esta análise", { exact: true }).click();
  await expect(page.getByText(/Não dá para desfazer/)).toBeVisible();
  expect((await page.request.get(`/r/${id}`)).status()).toBe(200);
  // Confirmando, apaga de vez.
  await page.getByRole("button", { name: "Sim, excluir definitivamente" }).click();
  await page.waitForURL(/\/minhas-analises/);
  expect((await page.request.get(`/r/${id}`)).status()).toBe(404);
});

// QA-04: depois de "Excluir tudo" o usuário vai para /?dados-excluidos=1, mas a landing
// ignora o parâmetro: nenhuma confirmação de que os dados foram apagados.
test("QA-04: a landing confirma a exclusão total dos dados", async ({ page }) => {
  await page.goto("/?dados-excluidos=1");
  await expect(page.getByRole("status")).toContainText(/exclu/i);
});

test("adicional que exige 'quem é você': vitrine pede o lado e depois libera a compra", async ({ page }) => {
  const id = await submitPastedConversation(page, `lado.${Date.now()}@example.com`);
  await confirmAndWaitReport(page, id); // "Prefiro não dizer"
  await payMainReport(page, id);
  const card = page.locator("article", { hasText: "Como responder" });
  await expect(card.getByRole("button", { name: /Comprar/ })).toHaveCount(0);
  await expect(card.getByText("diga qual das duas pessoas é você")).toBeVisible();
  // A página do adicional também não oferece compra.
  await page.goto(`/r/${id}/extra/como-responder`);
  await expect(page.getByRole("button", { name: /Comprar este relatório/ })).toHaveCount(0);
  await page.goto(`/r/${id}`);
  await page.locator("article", { hasText: "Como responder" }).getByRole("button", { name: "Sou Marina" }).click();
  // (QA-06 corrigido: o redirect passou a ser /r/[id]?lado=ok#extras e a vitrine já vem atualizada.)
  await page.waitForURL(new RegExp(`/r/${id}\\?lado=ok#extras$`));
  await expect(page.locator("article", { hasText: "Como responder" }).getByRole("button", { name: /Comprar/ })).toBeEnabled();
});

// QA-06: `setUserSideAction` grava o lado e redireciona para `/r/[id]#extras` (mesma URL + âncora).
// O roteador do Next trata como navegação por âncora e a vitrine continua mostrando
// "Sou Marina / Sou Téo" até o usuário recarregar a página (intermitente).
test("QA-06: depois de 'Sou Marina' a vitrine libera a compra sem recarregar", async ({ page }) => {
  const id = await submitPastedConversation(page, `lado2.${Date.now()}@example.com`);
  await confirmAndWaitReport(page, id);
  await payMainReport(page, id);
  await page.locator("article", { hasText: "Como responder" }).getByRole("button", { name: "Sou Marina" }).click();
  await expect(page.locator("article", { hasText: "Como responder" }).getByRole("button", { name: /Comprar/ })).toBeEnabled({ timeout: 5_000 });
});

// QA-05: a página de retorno acompanha a compra com `created_at` mais recente, mas o
// checkout REAPROVEITA compras pendentes antigas (D46). Quem abre o checkout de X, desiste,
// abre o de Y, desiste e volta a pagar X fica preso em "Confirmando seu pagamento…" (a tela
// acompanha Y, que nunca é pago), embora X já tenha sido liberado pelo webhook.
test("QA-05: retorno do pagamento acompanha a compra que acabou de ser paga", async ({ page }) => {
  const id = await submitPastedConversation(page, `retorno.${Date.now()}@example.com`);
  await confirmAndWaitReport(page, id, { iAm: "Marina" });
  await payMainReport(page, id);
  const buy = async (name: string, slug: string) => {
    await page.goto(`/r/${id}`);
    await page.locator("article", { hasText: name }).getByRole("button", { name: /Comprar/ }).click();
    await page.waitForURL(new RegExp(`/stripe/pay/${slug}`));
  };
  await buy("Quem demonstra mais interesse?", "quem-gosta-mais"); // compra A (pendente)
  await buy("Red flags", "red-flags"); // compra B (pendente, mais nova)
  await buy("Quem demonstra mais interesse?", "quem-gosta-mais"); // reaproveita A
  await page.getByRole("button", { name: "Pagar" }).click();
  await page.waitForURL(new RegExp(`/r/${id}/extra/quem-gosta-mais$`), { timeout: 20_000 });
});

test("mobile 375×812: cabeçalho e prévia do relatório sem rolagem horizontal", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const id = await submitPastedConversation(page, `mobile.${Date.now()}@example.com`);
  await confirmAndWaitReport(page, id);
  for (const path of [`/r/${id}`, "/", "/analisar", "/minhas-analises"]) {
    await page.goto(path);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect.soft(overflow, path).toBeLessThanOrEqual(0);
  }
  // O CTA de compra cabe na tela e é clicável.
  await page.goto(`/r/${id}`);
  const cta = page.getByRole("button", { name: /Desbloquear relatório completo/ }).first();
  await cta.scrollIntoViewIfNeeded();
  const box = await cta.boundingBox();
  expect(box && box.x >= 0 && box.x + box.width <= 375).toBe(true);
});

test("grupo: escolhe as 2 pessoas analisadas e o relatório usa só elas", async ({ page }) => {
  // Conversa de grupo FICTÍCIA (3 pessoas).
  const people = ["Ana", "Bruno", "Carla"];
  const lines: string[] = [];
  for (let i = 0; i < 30; i++) {
    const who = people[i % 3]!;
    const hh = String(8 + Math.floor(i / 6)).padStart(2, "0");
    const mm = String((i * 7) % 60).padStart(2, "0");
    lines.push(`03/10/2026 ${hh}:${mm} - ${who}: mensagem fictícia número ${i} sobre o passeio de sábado`);
  }
  await page.goto("/analisar");
  await page.getByRole("textbox", { name: "Conversa" }).fill(lines.join("\n"));
  await acceptAndSubmit(page, `grupo.${Date.now()}@example.com`);
  await page.waitForURL(/\/confirmar$/, { timeout: 60_000 });
  const id = /\/r\/([0-9a-f-]+)\//.exec(page.url())![1]!;
  await expect(page.getByRole("heading", { name: "Esta conversa tem mais de duas pessoas" })).toBeVisible();

  const p1 = page.getByRole("combobox", { name: "Pessoa 1" });
  const p2 = page.getByRole("combobox", { name: "Pessoa 2" });
  await p1.selectOption({ label: "Bruno (10 mensagens)" });
  await p2.selectOption({ label: "Bruno (10 mensagens)" });
  await expect(page.getByRole("button", { name: "Confirmar e gerar relatório" })).toBeDisabled();
  await p2.selectOption({ label: "Carla (10 mensagens)" });
  await expect(page.getByRole("radio", { name: "Sou Bruno" })).toBeVisible();
  await expect(page.getByRole("radio", { name: "Sou Carla" })).toBeVisible();
  await confirmAndWaitReport(page, id, { iAm: "Carla" });
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Bruno & Carla");
});
