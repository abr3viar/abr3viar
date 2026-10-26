import type { ReactNode } from "react";
import { legalReviewDone } from "@/env";

/** "2026-10-25" → "25 de outubro de 2026" (sem depender do fuso do servidor). */
function formatVersion(version: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(version);
  if (!m) return version;
  const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", dateStyle: "long" }).format(date);
}

export function LegalPage({ title, version, children }: { title: string; version: string; children: ReactNode }) {
  return (
    <article className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="font-serif text-3xl font-bold text-wine-900">{title}</h1>
      <p className="mt-2 text-sm text-stone-600">
        Versão de <time dateTime={version}>{formatVersion(version)}</time>
        {!legalReviewDone() && " · texto inicial, em revisão jurídica"}
      </p>
      <div className="legal mt-6 space-y-4 leading-relaxed text-stone-800 [&_a]:underline [&_a]:underline-offset-4 [&_h2]:mt-8 [&_h2]:font-serif [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:text-wine-900 [&_li]:ml-5 [&_li]:list-disc">
        {children}
      </div>
    </article>
  );
}
