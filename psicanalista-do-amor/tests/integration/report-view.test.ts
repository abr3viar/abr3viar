import { eq } from "drizzle-orm";
import { afterAll, beforeEach, expect, it } from "vitest";
import { closeDb, getDb } from "@/server/db/client";
import { reportSections, reports } from "@/server/db/schema";
import { stopBoss } from "@/server/jobs/boss";
import { processStripeEvent } from "@/server/payments/fulfill";
import { getReportView, getReportViewBySlug } from "@/server/reports/get-report-view";
import { describeDb, prepareTestDb } from "../helpers/db";
import { configureTestLinks, createPendingPurchase, createReadyMainReport, createUserWithSession, SECRET } from "../helpers/factories";
import { checkoutSession, event } from "../helpers/stripe-events";

describeDb("getReportView (banco)", () => {
  beforeEach(async () => {
    await prepareTestDb();
    await configureTestLinks();
  });
  afterAll(async () => {
    await stopBoss();
    await closeDb();
  });

  it("bloqueado: JSON serializado não contém nenhum trecho das seções bloqueadas", async () => {
    const { user, viewer } = await createUserWithSession("dona@example.com");
    const { report } = await createReadyMainReport(user.id);
    const view = await getReportView(report.id, viewer);
    expect(view).not.toBeNull();
    const json = JSON.stringify(view);
    expect(json).not.toContain(SECRET);
    expect(view!.sections.filter((s) => s.kind === "open")).toHaveLength(4);
    expect(view!.sections.filter((s) => s.kind === "locked")).toHaveLength(4);
    expect(view!.hook).toBe("Gancho de teste com Lucas");
    expect(view!.purchasable).toBe(true);
    for (const s of view!.sections) {
      if (s.kind === "locked") expect(Object.keys(s).sort()).toEqual(["kind", "lengthHint", "lockedTitle", "position"]);
    }
    // Título bloqueado é exibido decifrado, mas fica CIFRADO no banco (regra crítica 6).
    expect(view!.sections.find((s) => s.kind === "locked" && s.position === 5)).toMatchObject({ lockedTitle: "Instigante 5" });
    const raw = await getDb().select({ t: reportSections.lockedTitle }).from(reportSections).where(eq(reportSections.reportId, report.id));
    expect(raw.length).toBeGreaterThan(0);
    for (const r of raw) {
      expect(r.t.startsWith("v1:")).toBe(true);
      expect(r.t).not.toContain("Instigante");
    }
  });

  it("títulos bloqueados antigos em texto puro são cifrados na inicialização (D83) e continuam legíveis", async () => {
    const { user, viewer } = await createUserWithSession("legado@example.com");
    const { report } = await createReadyMainReport(user.id);
    await getDb().update(reportSections).set({ lockedTitle: "Título antigo em texto puro" }).where(eq(reportSections.reportId, report.id));
    const { encryptLegacyLockedTitles } = await import("@/server/db/migrate");
    expect(await encryptLegacyLockedTitles()).toBeGreaterThan(0);
    const raw = await getDb().select({ t: reportSections.lockedTitle }).from(reportSections).where(eq(reportSections.reportId, report.id));
    expect(raw.every((r) => r.t.startsWith("v1:"))).toBe(true);
    const view = await getReportView(report.id, viewer);
    expect(view!.sections.find((s) => s.kind === "locked")).toMatchObject({ lockedTitle: "Título antigo em texto puro" });
    expect(await encryptLegacyLockedTitles()).toBe(0); // idempotente
  });

  it("desbloqueado pelo webhook: tudo aberto e sem gancho", async () => {
    const { user, viewer } = await createUserWithSession("paga@example.com");
    const { report } = await createReadyMainReport(user.id);
    const purchase = await createPendingPurchase(user.id, report.id);
    await processStripeEvent(event("checkout.session.completed", checkoutSession({ client_reference_id: purchase.id })));
    const view = await getReportView(report.id, viewer);
    expect(view!.isUnlocked).toBe(true);
    expect(view!.hook).toBeNull();
    expect(view!.sections.every((s) => s.kind === "open")).toBe(true);
    expect(JSON.stringify(view)).toContain(`${SECRET}-conteudo-virada`);
  });

  it("alerta de risco nunca fica bloqueado", async () => {
    const { user, viewer } = await createUserWithSession("alerta@example.com");
    const { report } = await createReadyMainReport(user.id, { safety: true });
    const view = await getReportView(report.id, viewer);
    expect(view!.safetyFlag).toBe(true);
    const first = view!.sections[0]!;
    expect(first.kind).toBe("open");
    expect(JSON.stringify(view)).toContain("ALERTA-VISIVEL");
    // As 4 primeiras regulares continuam grátis; a segunda metade continua bloqueada.
    expect(view!.sections.filter((s) => s.kind === "open")).toHaveLength(5);
    expect(JSON.stringify(view)).not.toContain(SECRET);
  });

  it("autorização: outro usuário, sessão leve de outro navegador e id inválido → null (404)", async () => {
    const { user, viewer } = await createUserWithSession("dono@example.com", false);
    const { report, conversation } = await createReadyMainReport(user.id, { createdBySessionId: viewer.sessionId });
    expect(await getReportView(report.id, viewer)).not.toBeNull();

    const other = await createUserWithSession("intruso@example.com");
    expect(await getReportView(report.id, other.viewer)).toBeNull();
    expect(await getReportViewBySlug(conversation.id, "principal", other.viewer)).toBeNull();

    // Mesma conta, mas sessão leve (não verificada) criada em outro navegador.
    const lightOther = { ...viewer, sessionId: "0192f000-0000-7000-8000-000000000001" };
    expect(await getReportView(report.id, lightOther)).toBeNull();
    // Sessão verificada (link mágico) do dono vê tudo.
    expect(await getReportView(report.id, { ...lightOther, verified: true })).not.toBeNull();

    expect(await getReportView("nao-e-uuid", viewer)).toBeNull();
    expect(await getReportView(report.id, null)).toBeNull();
  });

  it("relatório ainda não pronto não devolve seções", async () => {
    const { user, viewer } = await createUserWithSession("pendente@example.com");
    const { report } = await createReadyMainReport(user.id);
    await getDb().update(reports).set({ status: "generating" }).where(eq(reports.id, report.id));
    const view = await getReportView(report.id, viewer);
    expect(view!.sections).toHaveLength(0);
    expect(view!.hook).toBeNull();
  });
});
