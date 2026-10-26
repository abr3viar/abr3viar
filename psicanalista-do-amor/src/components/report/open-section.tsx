import type { OpenSectionView } from "@/lib/views";
import { ChevronDownIcon } from "../icons";
import { SafeMarkdown } from "./markdown";

/**
 * Seção aberta: texto corrido com título, sem caixa própria (o relatório lê-se como um texto).
 * A seção de alerta de risco (`isSafety`) mantém o destaque, em amarelo com borda forte.
 */
export function OpenSection({ section }: { section: OpenSectionView }) {
  return (
    <section
      className={section.isSafety ? "alert-safety rounded-card" : "scroll-mt-6"}
      aria-labelledby={`sec-${section.position}`}
    >
      <h2 id={`sec-${section.position}`} className="heading-2">
        {section.title}
      </h2>
      <div className="mt-4">
        <SafeMarkdown>{section.contentMarkdown}</SafeMarkdown>
      </div>
      {section.evidence.length > 0 && (
        <details className="group mt-5 border-t border-wine-100 pt-3 text-sm">
          <summary className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-control font-medium text-wine-700 hover:text-wine-900">
            Trechos da conversa que sustentam isso
            <ChevronDownIcon className="h-4 w-4 shrink-0 group-open:rotate-180 motion-safe:transition-transform" />
          </summary>
          <ul className="mt-2 space-y-2">
            {section.evidence.map((e) => (
              <li key={e.seq} className="rounded-control border-l-2 border-wine-300 bg-wine-50 px-3 py-2 text-ink">
                “{e.quote}” <span className="text-xs text-muted">#{e.seq}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
