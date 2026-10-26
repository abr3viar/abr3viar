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
 *
 * Visual: sem caixa própria. Um filete tracejado marca a virada, o lorem desbota sobre o
 * fundo da própria folha (`tone`) e o botão de desbloqueio fica por cima do desbotado.
 */
export function LockedSection({
  position,
  lockedTitle,
  lengthHint,
  headingLevel = 2,
  unlockHref = "#desbloquear",
  tone = "cream",
}: {
  position: number;
  lockedTitle: string;
  lengthHint: "short" | "medium" | "long";
  /** 2 no relatório; 3 na landing (dentro da seção "Um exemplo"). */
  headingLevel?: 2 | 3;
  /** Para onde leva "Disponível no relatório completo" (o CTA de pagamento). */
  unlockHref?: string;
  /** Cor da folha onde o bloqueio está: o desbotado precisa casar com ela. */
  tone?: "cream" | "paper";
}) {
  const paragraphs = useMemo(() => makeLorem(position, lengthHint), [position, lengthHint]);
  const Heading = headingLevel === 3 ? "h3" : "h2";
  const fade = tone === "paper" ? "from-paper" : "from-cream";

  return (
    <section className="relative" aria-label={`${lockedTitle} (bloqueada)`}>
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-wine-200 bg-paper text-wine-700">
          <LockIcon className="h-4 w-4" />
        </span>
        <Heading className="heading-3 text-balance">{lockedTitle}</Heading>
      </div>
      <div className="relative mt-4 overflow-hidden">
        <div aria-hidden="true" data-nosnippet="" className="pointer-events-none space-y-3 text-reading text-muted blur-[5px] select-none">
          {paragraphs.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>
        <div aria-hidden="true" className={`pointer-events-none absolute inset-0 bg-linear-to-t ${fade} via-transparent to-transparent`} />
      </div>
      <div className="relative -mt-14 flex justify-center pb-1">
        <a href={unlockHref} className="btn-secondary min-h-11 shadow-card">
          Disponível no relatório completo
          <ArrowRightIcon className="h-4 w-4" />
        </a>
      </div>
    </section>
  );
}
