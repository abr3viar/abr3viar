import { expect, test } from "./fixtures";

test("a página inicial carrega com o aviso de IA", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByText("não substitui aconselhamento").first()).toBeVisible();
});

test("healthcheck responde sem expor detalhes", async ({ request }) => {
  const res = await request.get("/api/health");
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body).toEqual({ status: "ok" });
});
