import type { OpenSectionView } from "@/lib/views";
import { ChevronDownIcon } from "../icons";
import { SafeMarkdown } from "./markdown";

export function OpenSection({ section }: { section: OpenSectionView }) {
  return (
    <section
      className={section.isSafety ? "rounded-2xl border-2 border-amber-300 bg-amber-50 p-6" : "card"}
      aria-labelledby={`sec-${section.position}`}
    >
      <h2 id={`sec-${section.position}`} className="font-serif text-xl font-semibold text-wine-900">
        {section.title}
      </h2>
      <div className="mt-3 text-stone-800">
        <SafeMarkdown>{section.contentMarkdown}</SafeMarkdown>
      </div>
      {section.evidence.length > 0 && (
        <details className="group mt-3 text-sm">
          <summary className="-mx-2 inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-lg px-2 font-medium text-wine-700 hover:bg-wine-50">
            Trechos da conversa que sustentam isso
            <ChevronDownIcon className="h-4 w-4 shrink-0 group-open:rotate-180 motion-safe:transition-transform" />
          </summary>
          <ul className="mt-2 space-y-1">
            {section.evidence.map((e) => (
              <li key={e.seq} className="rounded-lg bg-wine-50 px-3 py-2 text-stone-700">
                “{e.quote}” <span className="text-xs text-stone-600">#{e.seq}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
