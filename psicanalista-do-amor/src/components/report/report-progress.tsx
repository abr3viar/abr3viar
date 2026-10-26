"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { progressLabel } from "@/lib/messages";

type Status = { status: string; progress: { step: string; current?: number; total?: number } | null };

/** Acompanha a geração de um relatório adicional e recarrega quando ficar pronto. */
export function ReportProgress({ reportId, initial }: { reportId: string; initial: Status }) {
  const router = useRouter();
  const [state, setState] = useState(initial);
  useEffect(() => {
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/reports/${reportId}/status`, { cache: "no-store" });
        if (!res.ok) return;
        const next = (await res.json()) as Status;
        setState(next);
        if (next.status === "ready" || next.status === "failed") router.refresh();
      } catch {
        // próximo ciclo
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [reportId, router]);
  const pct = state.progress?.current && state.progress.total ? Math.round((state.progress.current / state.progress.total) * 100) : null;
  return (
    <div className="card space-y-3" aria-live="polite">
      <p className="font-medium text-wine-900">
        {state.status === "queued" ? "Na fila…" : progressLabel(state.progress)}
        {pct !== null ? ` — ${pct}%` : ""}
      </p>
      <div className="h-2 overflow-hidden rounded-full bg-wine-100">
        <div className="h-full rounded-full bg-wine-500 motion-safe:animate-pulse motion-safe:transition-all" style={{ width: `${pct ?? (state.status === "queued" ? 15 : 60)}%` }} />
      </div>
      <p className="text-sm text-stone-600">Pagamento confirmado. Estamos escrevendo seu relatório — leva de alguns segundos a poucos minutos.</p>
    </div>
  );
}
