"use client";

import { useMemo } from "react";
import { ArrowRightIcon, LockIcon } from "../icons";

const WORDS =
  "lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua enim ad minim veniam quis nostrud exercitation ullamco laboris nisi aliquip ex ea commodo consequat duis aute irure in reprehenderit voluptate velit esse cillum fugiat nulla pariatur excepteur sint occaecat cupidatat non proident sunt culpa qui officia deserunt mollit anim id est laborum".split(
    " ",
  );

function makeLorem(position: number, lengthHint: "short" | "medium" | "long"): string[] {
  let seed = position * 9301 + 49297;
  const rand = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  const count = lengthHint === "short" ? 2 : lengthHint === "medium" ? 3 : 4;
  return Array.from({ length: count }, () =>
    Array.from({ length: 28 + Math.floor(rand() * 20) }, () => WORDS[Math.floor(rand() * WORDS.length)]).join(" "),
  );
}

/**
 * "Texto desfocado" de uma seção bloqueada: lorem ipsum GERADO NO NAVEGADOR (plano.md 7.3).
 * Nenhum conteúdo real chega aqui — só o título instigante e uma faixa de tamanho.
 * O lorem é determinístico (mesma altura no servidor e no navegador: sem layout shift) e
 * leva `data-nosnippet` para não virar trecho de busca na landing (SEO-12).
 */
export function LockedSection({
  position,
  lockedTitle,
  lengthHint,
  headingLevel = 2,
  unlockHref = "#desbloquear",
}: {
  position: number;
  lockedTitle: string;
  lengthHint: "short" | "medium" | "long";
  /** 2 no relatório; 3 na landing (dentro da seção "Um exemplo"). */
  headingLevel?: 2 | 3;
  /** Para onde leva "Disponível no relatório completo" (o CTA de pagamento). */
  unlockHref?: string;
}) {
  const paragraphs = useMemo(() => makeLorem(position, lengthHint), [position, lengthHint]);
  const Heading = headingLevel === 3 ? "h3" : "h2";

  return (
    <section className="card relative overflow-hidden" aria-label={`${lockedTitle} (bloqueada)`}>
      <Heading className="flex items-start gap-3 font-serif text-xl font-semibold text-wine-900">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-wine-50 text-wine-700">
          <LockIcon className="h-4.5 w-4.5" />
        </span>
        <span className="pt-0.5">{lockedTitle}</span>
      </Heading>
      <div className="relative mt-3">
        <div aria-hidden="true" data-nosnippet="" className="pointer-events-none space-y-3 blur-[5px] select-none">
          {paragraphs.map((p, i) => (
            <p key={i} className="leading-relaxed text-stone-600">{p}</p>
          ))}
        </div>
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-white via-white/80 to-transparent" />
      </div>
      <a
        href={unlockHref}
        className="relative -mt-6 inline-flex min-h-11 items-center gap-2 rounded-full border border-wine-200 bg-white px-4 text-sm font-medium text-wine-800 shadow-sm hover:border-wine-400 hover:bg-wine-50"
      >
        Disponível no relatório completo
        <ArrowRightIcon className="h-4 w-4" />
      </a>
    </section>
  );
}
