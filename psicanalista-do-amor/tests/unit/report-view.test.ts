import { describe, expect, it } from "vitest";
import { encryptField, encryptJson } from "@/server/crypto";
import type { Report, ReportSection, ReportType } from "@/server/db/schema";
import { buildReportView, lengthHint } from "@/server/reports/get-report-view";
import { computeFreeFlags } from "@/server/reports/sections";

const SECRET = "SEGREDO";

function section(position: number, isFree: boolean, isSafety = false): ReportSection {
  return {
    id: `s${position}`,
    reportId: "r1",
    position,
    key: `k${position}`,
    title: encryptField(`${SECRET}-titulo-${position}`),
    lockedTitle: `Bloqueado ${position}`,
    content: encryptField(`${SECRET}-conteudo-${position} `.repeat(40)),
    isFree,
    isSafety,
    evidence: encryptJson([{ seq: 1, quote: `${SECRET}-quote-${position}` }]),
  };
}

const rt = { id: "t1", slug: "principal", kind: "main", name: "Relatório", priceCents: 3000, currency: "brl" } as ReportType;
const baseReport = {
  id: "r1",
  status: "ready",
  isUnlocked: false,
  hookText: encryptField("gancho"),
  verdict: encryptJson({ label: `${SECRET}-verdict`, score: 60, explanation: "x" }),
  safetyFlag: false,
  errorCode: null,
  progress: null,
} as unknown as Report;
const conversation = { id: "c1", participantAName: encryptField("Ana"), participantBName: encryptField("Lucas") };

describe("buildReportView (sem banco)", () => {
  it("com is_unlocked=false o JSON serializado não contém conteúdo, título real, evidências nem veredito bloqueados", () => {
    const sections = [1, 2, 3, 4, 5, 6, 7, 8].map((p) => section(p, p <= 4));
    const view = buildReportView({ conversation, report: baseReport, reportType: rt, sections }, { purchasable: true });
    const json = JSON.stringify(view);
    for (const p of [5, 6, 7, 8]) {
      expect(json).not.toContain(`${SECRET}-conteudo-${p}`);
      expect(json).not.toContain(`${SECRET}-titulo-${p}`);
      expect(json).not.toContain(`${SECRET}-quote-${p}`);
    }
    expect(json).not.toContain(`${SECRET}-verdict`);
    expect(json).toContain(`${SECRET}-conteudo-1`);
    expect(view.hook).toBe("gancho");
  });

  it("desbloqueado mostra tudo e omite o gancho", () => {
    const sections = [1, 2, 3, 4, 5, 6, 7, 8].map((p) => section(p, p <= 4));
    const view = buildReportView(
      { conversation, report: { ...baseReport, isUnlocked: true }, reportType: rt, sections },
      { purchasable: true },
    );
    expect(view.hook).toBeNull();
    expect(view.sections.every((s) => s.kind === "open")).toBe(true);
    expect(view.verdict?.score).toBe(60);
  });

  it("faixas de tamanho em vez do tamanho exato", () => {
    expect(lengthHint(100)).toBe("short");
    expect(lengthHint(1000)).toBe("medium");
    expect(lengthHint(5000)).toBe("long");
  });
});

describe("is_free definido pelo servidor", () => {
  it("principal: 4 de 8 grátis; alerta de risco sempre grátis", () => {
    const regular = Array.from({ length: 8 }, () => ({ isSafety: false }));
    expect(computeFreeFlags(regular, "main")).toEqual([true, true, true, true, false, false, false, false]);
    expect(computeFreeFlags([{ isSafety: true }, ...regular], "main")).toEqual([true, true, true, true, true, false, false, false, false]);
    expect(computeFreeFlags(Array.from({ length: 7 }, () => ({ isSafety: false })), "main").filter(Boolean)).toHaveLength(4);
  });

  it("adicionais: nada grátis, exceto alerta", () => {
    expect(computeFreeFlags([{ isSafety: false }, { isSafety: true }], "extra")).toEqual([false, true]);
  });
});
