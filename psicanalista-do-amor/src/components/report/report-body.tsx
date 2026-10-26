import type { ReactNode } from "react";
import type { ReportView } from "@/lib/views";
import { LockedSection } from "./locked-section";
import { OpenSection } from "./open-section";
import { SafetyBox } from "./safety-box";

/**
 * Corpo do relatório: seções abertas, gancho, marcador de virada, seções bloqueadas (só título) e CTA.
 * `cta` vai logo depois do gancho; `ctaEnd`, depois da última seção bloqueada (UX-2),
 * para a página não terminar sem uma ação de compra.
 * A passagem grátis → bloqueado é um filete com rótulo: a leitura muda de ritmo sem susto.
 */
export function ReportBody({ view, cta, ctaEnd }: { view: ReportView; cta?: ReactNode; ctaEnd?: ReactNode }) {
  const lastOpenIndex = view.sections.reduce((acc, s, i) => (s.kind === "open" ? i : acc), -1);
  const lastLockedIndex = view.sections.reduce((acc, s, i) => (s.kind === "locked" ? i : acc), -1);
  const firstLockedIndex = view.sections.findIndex((s) => s.kind === "locked");
  return (
    <div className="space-y-12">
      {view.safetyFlag && <SafetyBox />}
      {view.sections.map((s, i) => (
        <div key={s.position} className="space-y-12">
          {i === firstLockedIndex && (
            <div role="presentation" className="flex items-center gap-4 pt-2 text-xs font-semibold tracking-[0.14em] text-wine-700 uppercase">
              <span className="h-px flex-1 bg-wine-200" />
              Continua no relatório completo
              <span className="h-px flex-1 bg-wine-200" />
            </div>
          )}
          {s.kind === "open" ? (
            <OpenSection section={s} />
          ) : (
            <LockedSection position={s.position} lockedTitle={s.lockedTitle} lengthHint={s.lengthHint} />
          )}
          {i === lastOpenIndex && view.hook && (
            <div className="space-y-6">
              <p className="rounded-card bg-wine-900 p-6 font-serif text-lg leading-relaxed text-cream italic shadow-raised sm:p-8 sm:text-xl">
                {view.hook}
              </p>
              {cta}
            </div>
          )}
          {i === lastLockedIndex && ctaEnd}
        </div>
      ))}
    </div>
  );
}
