import type { VerdictView } from "@/lib/views";

/** Placar visual do relatório adicional (ex.: interesse 64% × 36%). */
export function Verdict({ verdict, twoSided, names }: { verdict: VerdictView; twoSided: boolean; names: { a: string; b: string } }) {
  const score = verdict.score === null ? null : Math.max(0, Math.min(100, verdict.score));
  return (
    <section className="card space-y-4 border-wine-300" aria-label="Resultado">
      <p className="text-sm font-semibold uppercase tracking-wide text-wine-600">Resultado</p>
      <p className="font-serif text-2xl font-bold text-wine-900">{verdict.label}</p>
      {score !== null &&
        (twoSided ? (
          <div>
            <div className="flex justify-between text-sm font-medium">
              <span>{names.a} — {score}%</span>
              <span>{100 - score}% — {names.b}</span>
            </div>
            <div className="mt-2 flex h-4 overflow-hidden rounded-full" role="img" aria-label={`${names.a} ${score}%, ${names.b} ${100 - score}%`}>
              <div className="bg-wine-600" style={{ width: `${score}%` }} />
              <div className="bg-wine-200" style={{ width: `${100 - score}%` }} />
            </div>
          </div>
        ) : (
          <div>
            <div className="h-4 overflow-hidden rounded-full bg-wine-100" role="img" aria-label={`${score} de 100`}>
              <div className="h-full bg-wine-600" style={{ width: `${score}%` }} />
            </div>
            <p className="mt-1 text-sm text-stone-600">{score} de 100</p>
          </div>
        ))}
      {verdict.explanation && <p className="text-stone-700">{verdict.explanation}</p>}
    </section>
  );
}
