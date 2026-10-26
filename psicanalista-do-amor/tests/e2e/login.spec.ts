import { expect, test } from "./fixtures";
import { latestEmailTo } from "./helpers";

test("link mágico: pede, recebe por e-mail, entra com um clique e o link não funciona duas vezes", async ({ page }) => {
  const email = `login.${Date.now()}@example.com`;
  const since = Date.now();
  await page.goto("/entrar");
  await page.getByLabel("Seu e-mail").fill(email);
  await page.getByRole("button", { name: "Receber link de acesso" }).click();
  await expect(page.getByRole("status")).toContainText("enviamos um link de acesso");

  await expect.poll(() => latestEmailTo(email, "magic_link", since) !== null, { timeout: 10_000 }).toBe(true);
  const mail = latestEmailTo(email, "magic_link", since)!;
  const link = /(http:\/\/[^\s]+\/entrar\/verificar\?token=[A-Za-z0-9_-]+)/.exec(mail.text)![1]!;

  // Abrir o link (GET) não consome o token; só o clique em "Entrar".
  await page.goto(link);
  await page.goto(link);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL(/\/minhas-analises$/);
  await expect(page.getByRole("heading", { name: "Minhas análises" })).toBeVisible();

  // Uso único
  await page.goto(link);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL(/\/entrar\?erro=link$/);
});
