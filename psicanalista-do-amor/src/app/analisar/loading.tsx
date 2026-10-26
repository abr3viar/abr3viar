import { SkeletonCard, SkeletonLine } from "@/components/skeleton";

/** Esqueleto do envio, no mesmo formato do formulário (sem salto quando ele chega). */
export default function Loading() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10" role="status" aria-live="polite">
      <span className="sr-only">Carregando…</span>
      <div aria-hidden="true">
        <SkeletonLine className="h-8 w-2/3" />
        <SkeletonLine className="mt-4 h-4 w-full" />
        <SkeletonLine className="mt-2 h-4 w-4/5" />
        <div className="mt-8 grid grid-cols-2 gap-2">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="h-12 rounded-control border border-wine-100 bg-white" />
          ))}
        </div>
        <SkeletonCard lines={6} className="mt-6" />
        <SkeletonCard lines={3} className="mt-6" />
      </div>
    </div>
  );
}
