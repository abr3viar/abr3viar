"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { z } from "zod";
import { ClockIcon } from "./icons";

const statusSchema = z.object({ active: z.boolean() });
/** Depois disso a tela para de consultar e oferece "Verificar de novo". */
const MAX_MS = 120_000;

type Phase = "waiting" | "active" | "stopped";

/** Acompanha a ativação da assinatura depois do pagamento (só lê; quem ativa é o webhook, D96). */
export function SubscriptionReturnPoller() {
  const [phase, setPhase] = useState<Phase>("waiting");
  const [round, setRound] = useState(0);

  useEffect(() => {
    const started = Date.now();
    let alive = true;
    let inFlight = false;
    const controller = new AbortController();
    const timer = setInterval(() => void tick(), 2000);
    async function tick() {
      if (inFlight || !alive) return;
      if (Date.now() - started > MAX_MS) {
        clearInterval(timer);
        setPhase("stopped");
        return;
      }
      inFlight = true;
      try {
        const res = await fetch("/api/subscription/status", { cache: "no-store", signal: controller.signal });
        if (!res.ok || !alive) return;
        const parsed = statusSchema.safeParse(await res.json());
        if (parsed.success && parsed.data.active && alive) {
          clearInterval(timer);
          setPhase("active");
        }
      } catch {
        // tenta de novo no próximo ciclo
      } finally {
        inFlight = false;
      }
    }
    void tick();
    return () => {
      alive = false;
      clearInterval(timer);
      controller.abort();
    };
  }, [round]);

  if (phase === "active") {
    return (
      <div className="space-y-4">
        <h1 className="font-serif text-2xl font-bold text-wine-900">Assinatura ativa</h1>
        <p className="text-muted">Pronto! Agora é só abrir uma análise e liberar o relatório completo pela assinatura.</p>
        <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
          <Link href="/minhas-analises" className="btn-primary">Minhas análises</Link>
          <Link href="/analisar" className="btn-secondary">Analisar uma conversa</Link>
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-4" aria-live="polite">
      <ClockIcon className={`mx-auto h-10 w-10 text-wine-600 ${phase === "waiting" ? "animate-pulse" : ""}`} />
      <h1 className="font-serif text-2xl font-bold text-wine-900">
        {phase === "waiting" ? "Confirmando sua assinatura…" : "A confirmação está demorando"}
      </h1>
      <p className="text-muted">
        {phase === "waiting"
          ? "Isso costuma levar poucos segundos."
          : "Se o pagamento foi aprovado, a assinatura aparece em Minha conta em alguns minutos."}
      </p>
      {phase === "stopped" && (
        <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
          <button type="button" className="btn-primary" onClick={() => { setPhase("waiting"); setRound((r) => r + 1); }}>
            Verificar de novo
          </button>
          <Link href="/conta#assinatura" className="btn-secondary">Minha conta</Link>
        </div>
      )}
    </div>
  );
}
