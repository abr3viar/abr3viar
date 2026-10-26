import type { ReactNode } from "react";
import type { ReportView } from "@/lib/views";
import { LockedSection } from "./locked-section";
import { OpenSection } from "./open-section";
import { SafetyBox } from "./safety-box";

/**
 * Corpo do relatório: seções abertas, gancho, seções bloqueadas (só título) e CTA.
 * `cta` vai logo depois do gancho; `ctaEnd`, depois da última seção bloqueada (UX-2),
 * para a página não terminar sem uma ação de compra.
 */
export function ReportBody({ view, cta, ctaEnd }: { view: ReportView; cta?: ReactNode; ctaEnd?: ReactNode }) {
  const lastOpenIndex = view.sections.reduce((acc, s, i) => (s.kind === "open" ? i : acc), -1);
  const lastLockedIndex = view.sections.reduce((acc, s, i) => (s.kind === "locked" ? i : acc), -1);
  return (
    <div className="space-y-6">
      {view.safetyFlag && <SafetyBox />}
      {view.sections.map((s, i) => (
        <div key={s.position} className="space-y-6">
          {s.kind === "open" ? (
            <OpenSection section={s} />
          ) : (
            <LockedSection position={s.position} lockedTitle={s.lockedTitle} lengthHint={s.lengthHint} />
          )}
          {i === lastOpenIndex && view.hook && (
            <>
              <p className="rounded-2xl bg-wine-900 p-6 font-serif text-lg leading-relaxed text-white italic">{view.hook}</p>
              {cta}
            </>
          )}
          {i === lastLockedIndex && ctaEnd}
        </div>
      ))}
    </div>
  );
}
