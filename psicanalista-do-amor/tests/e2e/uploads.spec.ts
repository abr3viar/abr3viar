import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { buildZip } from "../helpers/zip";
import { fakeScreenshot } from "../helpers/images";

async function fillCommon(page: Page, email: string) {
  await page.getByLabel("Seu e-mail").fill(email);
  for (const box of await page.getByRole("checkbox").all()) await box.check();
  await page.getByRole("button", { name: "Analisar conversa" }).click();
}

test("prints: envio, OCR simulado, confirmação com esquerda/direita e relatório", async ({ page }) => {
  await page.goto("/analisar");
  await page.getByRole("radio", { name: "Prints" }).click();
  const files = await Promise.all(
    [1, 2, 3].map(async (seed) => ({ name: `Screenshot_${seed}.png`, mimeType: "image/png", buffer: await fakeScreenshot({ seed }) })),
  );
  await page.locator('input[type="file"]').setInputFiles(files);
  await fillCommon(page, "prints.e2e@example.com");
  await page.waitForURL(/\/confirmar$/, { timeout: 60_000 });
  await expect(page.getByText("Pessoa da direita").first()).toBeVisible();
  await expect(page.locator('input[name="aName"], input[name="bName"]')).toHaveCount(2);
  await page.getByRole("button", { name: "Confirmar e gerar relatório" }).click();
  await page.waitForURL(/\/r\/[0-9a-f-]+$/, { timeout: 60_000 });
  await expect(page.getByText("CONTEUDO-LIVRE-retrato")).toBeVisible();
});

test("zip da exportação do WhatsApp: usa o _chat.txt", async ({ page }) => {
  const chat = readFileSync("tests/fixtures/e2e-conversation.txt");
  const zip = buildZip([
    { name: "_chat.txt", data: chat, deflate: true },
    { name: "IMG-0001.jpg", data: await fakeScreenshot({ format: "jpeg" }) },
  ]);
  await page.goto("/analisar");
  await page.getByRole("radio", { name: "Arquivo .zip" }).click();
  await page.locator('input[type="file"]').setInputFiles({ name: "WhatsApp Chat.zip", mimeType: "application/zip", buffer: zip });
  await fillCommon(page, "zip.e2e@example.com");
  await page.waitForURL(/\/confirmar$/, { timeout: 60_000 });
  await expect(page.getByText("Encontramos 32 mensagens")).toBeVisible();
});

test("arquivo com extensão falsa é recusado pelos magic bytes", async ({ page }) => {
  await page.goto("/analisar");
  await page.getByRole("radio", { name: "Arquivo .txt" }).click();
  await page.locator('input[type="file"]').setInputFiles({ name: "conversa.txt", mimeType: "text/plain", buffer: await fakeScreenshot() });
  await fillCommon(page, "falso.e2e@example.com");
  await expect(page.locator("#upload-error")).toContainText("não é aceito");
});

test("upload sem Origin do próprio site é recusado (CSRF)", async ({ request }) => {
  const res = await request.post("/api/uploads", {
    headers: { origin: "https://site-malicioso.example" },
    multipart: { mode: "paste", text: "Ana: oi\nLucas: oi", email: "x@example.com", consent_terms: "on", consent_adult: "on", consent_third_party: "on", consent_ai: "on" },
  });
  expect(res.status()).toBe(403);
});

test("arquivo acima do limite é barrado no navegador, sem chamar /api/uploads (QA-12)", async ({ page }) => {
  let uploads = 0;
  page.on("request", (r) => {
    if (r.url().includes("/api/uploads")) uploads++;
  });
  await page.goto("/analisar");
  await page.getByRole("radio", { name: "Arquivo .txt" }).click();
  await page.locator('input[type="file"]').setInputFiles({ name: "grande.txt", mimeType: "text/plain", buffer: Buffer.alloc(26 * 1024 * 1024, 97) });
  await expect(page.getByText(/o limite é 25 MB/)).toBeVisible();
  expect(uploads).toBe(0);
});
