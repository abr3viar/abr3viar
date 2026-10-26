import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, type Page } from "@playwright/test";

const OUTBOX = "./.data/e2e-outbox";

export function latestEmailTo(to: string, template: string, since = 0): { html: string; text: string } | null {
  let files: string[] = [];
  try {
    files = readdirSync(OUTBOX).sort().reverse();
  } catch {
    return null;
  }
  for (const f of files) {
    if (!f.endsWith(".json") || Number(f.split("-")[0]) < since) continue;
    let mail: { to: string; template: string; html: string; text: string };
    try {
      mail = JSON.parse(readFileSync(path.join(OUTBOX, f), "utf8")) as typeof mail;
    } catch {
      continue;
    }
    if (mail.to === to && mail.template === template) return mail;
  }
  return null;
}

/** Entra pelo link mágico lido do outbox local (e-mails de dev/teste). */
export async function loginByMagicLink(page: Page, email: string): Promise<void> {
  const since = Date.now();
  await page.goto("/entrar");
  await page.getByLabel("Seu e-mail").fill(email);
  await page.getByRole("button", { name: "Receber link de acesso" }).click();
  await expect(page.getByRole("status")).toContainText("enviamos um link de acesso");
  await expect.poll(() => latestEmailTo(email, "magic_link", since) !== null, { timeout: 10_000 }).toBe(true);
  const link = /(http:\/\/[^\s]+\/entrar\/verificar\?token=[A-Za-z0-9_-]+)/.exec(latestEmailTo(email, "magic_link", since)!.text)![1]!;
  await page.goto(link);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL(/\/minhas-analises$/);
}

const E2E_CONVERSATION = "tests/fixtures/e2e-conversation.txt";

/** Cola a conversa fictícia, aceita as declarações e espera a tela de confirmação. Devolve o id. */
export async function submitPastedConversation(page: Page, email: string): Promise<string> {
  await page.goto("/analisar");
  await page.getByRole("textbox", { name: "Conversa" }).fill(readFileSync(E2E_CONVERSATION, "utf8"));
  await page.getByLabel("Seu e-mail").fill(email);
  for (const box of await page.getByRole("checkbox").all()) await box.check();
  await page.getByRole("button", { name: "Analisar conversa" }).click();
  await page.waitForURL(/\/confirmar$/, { timeout: 60_000 });
  return /\/r\/([0-9a-f-]+)\//.exec(page.url())![1]!;
}

/** Confirma os participantes (opcionalmente "Sou Marina") e espera a prévia do relatório. */
export async function confirmAndWaitReport(page: Page, id: string, opts: { iAm?: string } = {}): Promise<void> {
  if (opts.iAm) await page.getByRole("radio", { name: new RegExp(`Sou ${opts.iAm}`) }).check();
  await page.getByRole("button", { name: "Confirmar e gerar relatório" }).click();
  await page.waitForURL(new RegExp(`/r/${id}$`), { timeout: 90_000 });
}

/** Paga o relatório principal pelo Payment Link simulado e espera o relatório completo. */
export async function payMainReport(page: Page, id: string): Promise<void> {
  await page.getByRole("button", { name: /Desbloquear relatório completo/ }).first().click();
  await page.waitForURL(/\/stripe\/pay\/principal/);
  await page.getByRole("button", { name: "Pagar" }).click();
  await page.waitForURL(new RegExp(`/r/${id}$`), { timeout: 60_000 });
  await expect(page.getByRole("heading", { name: "Quer ir mais fundo?" })).toBeVisible();
}
