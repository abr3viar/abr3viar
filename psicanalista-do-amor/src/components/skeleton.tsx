/** Blocos de "carregando" (UX-10). Pulsam só com movimento permitido. */
export function SkeletonLine({ className = "" }: { className?: string }) {
  return <div className={`rounded-full bg-wine-100/70 motion-safe:animate-pulse ${className}`} />;
}

export function SkeletonCard({ lines = 4, className = "" }: { lines?: number; className?: string }) {
  return (
    <div className={`card space-y-3 ${className}`}>
      <SkeletonLine className="h-5 w-2/3" />
      {Array.from({ length: lines }, (_, i) => (
        <SkeletonLine key={i} className={`h-3.5 ${i === lines - 1 ? "w-1/2" : "w-full"}`} />
      ))}
    </div>
  );
}
