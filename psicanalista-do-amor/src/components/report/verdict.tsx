import type { VerdictView } from "@/lib/views";

/** Placar visual do relatório adicional (ex.: interesse 64% × 36%). Destaque de veredito: cartão em destaque. */
export function Verdict({ verdict, twoSided, names }: { verdict: VerdictView; twoSided: boolean; names: { a: string; b: string } }) {
  const score = verdict.score === null ? null : Math.max(0, Math.min(100, verdict.score));
  return (
    <section className="card-featured space-y-4" aria-label="Resultado">
      <p className="eyebrow">Resultado</p>
      <p className="heading-2 text-balance">{verdict.label}</p>
      {score !== null &&
        (twoSided ? (
          <div>
            <div className="flex justify-between gap-3 text-sm font-semibold text-ink">
              <span>{names.a} — {score}%</span>
              <span>{100 - score}% — {names.b}</span>
            </div>
            <div className="mt-2 flex h-3 overflow-hidden rounded-full" role="img" aria-label={`${names.a} ${score}%, ${names.b} ${100 - score}%`}>
              <div className="bg-wine-600" style={{ width: `${score}%` }} />
              <div className="bg-wine-200" style={{ width: `${100 - score}%` }} />
            </div>
          </div>
        ) : (
          <div>
            <div className="h-3 overflow-hidden rounded-full bg-wine-100" role="img" aria-label={`${score} de 100`}>
              <div className="h-full rounded-full bg-wine-600" style={{ width: `${score}%` }} />
            </div>
            <p className="mt-1.5 text-sm text-muted">{score} de 100</p>
          </div>
        ))}
      {verdict.explanation && <p className="leading-relaxed text-ink">{verdict.explanation}</p>}
    </section>
  );
}
