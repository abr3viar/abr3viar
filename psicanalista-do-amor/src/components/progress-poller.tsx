"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { errorMessage, progressLabel } from "@/lib/messages";
import type { ConversationStatusView } from "@/lib/views";

const STEPS = [
  { key: "receive", label: "Recebendo", matches: ["uploaded"] },
  { key: "read", label: "Lendo e organizando", matches: ["processing"] },
  { key: "confirm", label: "Pronto para confirmar", matches: ["needs_confirmation"] },
  { key: "generate", label: "Escrevendo o relatório", matches: ["generating"] },
];

const TIPS = [
  "Estamos contando quem puxa assunto e quanto tempo cada um leva para responder.",
  "Os arquivos que você enviou são apagados assim que terminamos de ler.",
  "A conversa fica guardada cifrada. Ninguém da equipe abre conversas: o texto só passa pela IA para gerar o relatório.",
  "Conversas longas são lidas em partes — pode levar alguns minutos.",
];

export function ProgressPoller({
  conversationId,
  initial,
  retryAction,
}: {
  conversationId: string;
  initial: ConversationStatusView;
  retryAction: (form: FormData) => Promise<void>;
}) {
  const router = useRouter();
  const [state, setState] = useState(initial);
  const [tip, setTip] = useState(0);

  useEffect(() => {
    let active = true;
    const tick = async () => {
      try {
        const res = await fetch(`/api/conversations/${conversationId}/status`, { cache: "no-store" });
        if (!res.ok) return;
        const next = (await res.json()) as ConversationStatusView;
        if (!active) return;
        setState(next);
        if (next.status === "needs_confirmation") router.replace(`/r/${conversationId}/confirmar`);
        if (next.status === "ready") router.replace(`/r/${conversationId}`);
      } catch {
        // tenta de novo no próximo ciclo
      }
    };
    const timer = setInterval(tick, 2000);
    const tipTimer = setInterval(() => setTip((t) => (t + 1) % TIPS.length), 6000);
    return () => {
      active = false;
      clearInterval(timer);
      clearInterval(tipTimer);
    };
  }, [conversationId, router]);

  if (state.status === "failed") {
    return (
      <div className="card space-y-4" role="alert">
        <h2 className="text-xl font-semibold text-wine-900">Não conseguimos concluir</h2>
        <p className="text-stone-700">{errorMessage(state.errorCode)}</p>
        {state.canRetry ? (
          <form action={retryAction}>
            <input type="hidden" name="conversationId" value={conversationId} />
            <button type="submit" className="btn-primary">Tentar de novo</button>
          </form>
        ) : (
          <>
            <p className="text-sm text-muted">Por segurança, os arquivos enviados já foram apagados. Envie a conversa de novo para gerar o relatório.</p>
            <Link href="/analisar" className="btn-primary">Enviar outra conversa</Link>
          </>
        )}
      </div>
    );
  }

  const currentIndex = Math.max(0, STEPS.findIndex((s) => s.matches.includes(state.status)));
  const pct =
    state.progress?.current && state.progress.total
      ? Math.round((state.progress.current / state.progress.total) * 100)
      : null;

  return (
    <div className="card space-y-6">
      <ol className="space-y-3" aria-label="Etapas">
        {STEPS.map((s, i) => (
          <li key={s.key} className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className={`flex h-7 w-7 items-center justify-center rounded-full text-sm font-semibold ${
                i < currentIndex ? "bg-wine-600 text-white" : i === currentIndex ? "bg-wine-200 text-wine-900 ring-2 ring-wine-300 motion-safe:animate-pulse" : "bg-stone-100 text-muted"
              }`}
            >
              {i < currentIndex ? "✓" : i + 1}
            </span>
            <span className={i <= currentIndex ? "font-medium text-ink" : "text-stone-500"}>{s.label}</span>
          </li>
        ))}
      </ol>
      <div>
        <p className="font-medium text-wine-900" aria-live="polite">
          {progressLabel(state.progress)}
          {pct !== null ? ` — ${pct}%` : "…"}
        </p>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-wine-100">
          <div
            className="h-full rounded-full bg-wine-500 motion-safe:transition-all motion-safe:duration-700"
            style={{ width: `${pct ?? Math.min(90, 20 + currentIndex * 25)}%` }}
          />
        </div>
      </div>
      {/* Altura fixa de 3 linhas: a troca de dica não empurra o layout (UX-10). */}
      <p className="min-h-15 text-sm text-muted">{TIPS[tip]}</p>
    </div>
  );
}
