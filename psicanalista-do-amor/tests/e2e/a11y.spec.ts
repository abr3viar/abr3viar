import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { confirmAndWaitReport, loginByMagicLink, payMainReport, submitPastedConversation } from "./helpers";

/**
 * Acessibilidade (axe-core) nas telas principais, em viewport mobile (375×812) e desktop.
 * Critério: ZERO violações "serious" ou "critical" (WCAG 2.0/2.1 A e AA).
 * Também confere que nenhuma tela tem rolagem horizontal no mobile.
 */

const VIEWPORTS = [
  { name: "mobile", width: 375, height: 812 },
  { name: "desktop", width: 1280, height: 800 },
] as const;

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

type Found = { id: string; impact: string; help: string; targets: string[] };

/**
 * Violações conhecidas toleradas (com ID do bug). Hoje nenhuma: QA-07 (contraste de
 * `text-stone-400`) foi corrigido; qualquer violação séria/crítica falha.
 */
const KNOWN: { page: RegExp; rule: string; target: RegExp }[] = [];

async function audit(page: Page, label: string, viewportWidth: number): Promise<void> {
  await page.waitForLoadState("networkidle").catch(() => undefined);
  const result = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const serious: Found[] = result.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => ({
      id: v.id,
      impact: v.impact ?? "",
      help: v.help,
      targets: v.nodes
        .map((n) => n.target.join(" "))
        .filter((t) => !KNOWN.some((k) => k.page.test(label) && k.rule === v.id && k.target.test(t)))
        .slice(0, 5),
    }))
    .filter((v) => v.targets.length > 0);
  expect.soft(serious, `${label}: violações sérias/críticas do axe`).toEqual([]);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect.soft(overflow, `${label}: rolagem horizontal de ${overflow}px em ${viewportWidth}px`).toBeLessThanOrEqual(0);
}

for (const vp of VIEWPORTS) {
  test.describe(`acessibilidade — ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test(`telas principais sem violações sérias/críticas (${vp.width}×${vp.height})`, async ({ page }) => {
      test.setTimeout(240_000);
      const email = `a11y.${vp.name}.${Date.now()}@example.com`;

      for (const path of ["/", "/analisar", "/entrar", "/ajuda"]) {
        await page.goto(path);
        await audit(page, path, vp.width);
      }

      const id = await submitPastedConversation(page, email);
      await audit(page, "/r/[id]/confirmar", vp.width);

      await confirmAndWaitReport(page, id);
      await expect(page.getByText(/GANCHO-TESTE/)).toBeVisible();
      await audit(page, "/r/[id] (prévia bloqueada)", vp.width);

      await payMainReport(page, id);
      await expect(page.getByText("SEGREDO-BLOQUEADO-virada")).toBeVisible();
      await audit(page, "/r/[id] (relatório completo + vitrine)", vp.width);
      for (const summary of await page.locator("details > summary").all()) await summary.click();
      await audit(page, "/r/[id] (relatório completo, evidências abertas)", vp.width);

      await page.goto(`/r/${id}/extra/red-flags`);
      await audit(page, "/r/[id]/extra/[slug] (oferta)", vp.width);

      await page.goto(`/r/${id}`);
      await page.locator("article", { hasText: "Quem demonstra mais interesse?" }).getByRole("button", { name: /Comprar/ }).click();
      await page.waitForURL(/\/stripe\/pay\/quem-gosta-mais/);
      await page.getByRole("button", { name: "Pagar" }).click();
      await page.waitForURL(new RegExp(`/r/${id}/extra/quem-gosta-mais$`), { timeout: 60_000 });
      await expect(page.getByText("CONTEUDO-ADICIONAL-sinais-a")).toBeVisible({ timeout: 60_000 });
      await audit(page, "/r/[id]/extra/[slug] (adicional pago, com placar)", vp.width);

      await page.goto("/minhas-analises");
      await audit(page, "/minhas-analises (sessão leve)", vp.width);
      await page.goto("/conta");
      await audit(page, "/conta (sessão leve)", vp.width);

      await loginByMagicLink(page, email);
      await audit(page, "/minhas-analises (verificada)", vp.width);
      await page.goto("/conta");
      await audit(page, "/conta (verificada)", vp.width);
    });
  });
}
