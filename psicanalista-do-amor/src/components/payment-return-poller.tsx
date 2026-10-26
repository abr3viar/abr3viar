"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AlertIcon, ClockIcon } from "./icons";
import { z } from "zod";

/** Resposta de /api/purchases/latest (validada: o `target` vira navegação). */
const statusSchema = z.object({
  unlocked: z.boolean(),
  purchaseStatus: z.string().nullable(),
  target: z.string().regex(/^\/r\/[0-9a-f-]{36}(?:\/extra\/[a-z0-9-]+)?$/),
});

/** Depois disso a tela para de consultar (ícone parado) e oferece "Verificar de novo". */
const MAX_MS = 120_000;
/** A partir daqui mostra a explicação do Pix e as saídas (Minhas análises, Ajuda). */
const SLOW_MS = 20_000;

type Phase = "waiting" | "slow" | "stopped" | "failed";

/**
 * Acompanha a compra mais recente (só lê; quem libera é o webhook). Serve para o relatório
 * principal e para os adicionais: o destino (`target`) vem da API.
 */
export function PaymentReturnPoller({ reportId }: { reportId: string }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("waiting");
  const [target, setTarget] = useState<string | null>(null);
  const [round, setRound] = useState(0);

  useEffect(() => {
    const started = Date.now();
    let active = true;
    let timer: ReturnType<typeof setInterval> | undefined;
    // Cancela a consulta em andamento ao parar/sair (não deixa requisição pendurada).
    const controller = new AbortController();
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = undefined;
    };
    let inFlight = false;
    const tick = async () => {
      // Sem consultas em paralelo se a API demorar mais que o intervalo.
      if (inFlight) return;
      if (Date.now() - started > MAX_MS) {
        stop();
        if (active) setPhase((p) => (p === "failed" ? p : "stopped"));
        return;
      }
      inFlight = true;
      try {
        const res = await fetch(`/api/purchases/latest?report=${reportId}`, { cache: "no-store", signal: controller.signal });
        if (!res.ok || !active) return;
        const parsed = statusSchema.safeParse(await res.json());
        if (!parsed.success || !active) return; // resposta estranha: tenta de novo no próximo ciclo
        const body = parsed.data;
        setTarget(body.target);
        if (body.unlocked) {
          stop();
          controller.abort();
          router.replace(body.target);
          return;
        }
        if (body.purchaseStatus === "failed" || body.purchaseStatus === "expired" || body.purchaseStatus === "refunded" || body.purchaseStatus === "disputed") {
          stop();
          setPhase("failed");
        }
      } catch {
        // tenta de novo no próximo ciclo
      } finally {
        inFlight = false;
      }
    };
    void tick();
    timer = setInterval(tick, 2000);
    const slowTimer = setTimeout(() => active && setPhase((p) => (p === "waiting" ? "slow" : p)), SLOW_MS);
    return () => {
      active = false;
      stop();
      controller.abort();
      clearTimeout(slowTimer);
    };
  }, [reportId, router, round]);

  if (phase === "failed") {
    return (
      <div className="space-y-5" role="alert">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-50 text-amber-800">
          <AlertIcon className="h-6 w-6" />
        </span>
        <h1 className="font-serif text-2xl font-bold text-wine-900">O pagamento não foi concluído</h1>
        <p className="text-stone-700">Nenhum valor foi cobrado por esta tentativa. Você pode voltar e tentar de novo quando quiser.</p>
        <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:justify-center">
          {target && (
            <Link href={target} className="btn-primary">Voltar ao relatório e tentar de novo</Link>
          )}
          <Link href="/minhas-analises" className="btn-secondary">Minhas análises</Link>
        </div>
      </div>
    );
  }

  const stopped = phase === "stopped";
  return (
    <div className="space-y-5">
      {stopped ? (
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-wine-50 text-wine-700">
          <ClockIcon className="h-6 w-6" />
        </span>
      ) : (
        <>
          {/* Com movimento reduzido, o ícone de relógio substitui o spinner. */}
          <span
            aria-hidden="true"
            className="mx-auto hidden h-12 w-12 rounded-full border-4 border-wine-200 border-t-wine-600 motion-safe:block motion-safe:animate-spin"
          />
          <span className="mx-auto hidden h-12 w-12 items-center justify-center rounded-full bg-wine-50 text-wine-700 motion-reduce:flex">
            <ClockIcon className="h-6 w-6" />
          </span>
        </>
      )}
      <h1 className="font-serif text-2xl font-bold text-wine-900">
        {stopped ? "Ainda aguardando a confirmação" : "Confirmando seu pagamento…"}
      </h1>
      <div aria-live="polite" className="space-y-4">
        {stopped ? (
          <p className="text-stone-700">
            O Stripe ainda não confirmou o pagamento. Se você pagou, o relatório é liberado assim que a confirmação
            chegar, e você recebe um e-mail quando ele estiver pronto para ler. Pode fechar esta página.
          </p>
        ) : (
          <p className="text-muted">Assim que o Stripe confirmar, você vai direto para o relatório.</p>
        )}
        {phase === "slow" && (
          <p className="rounded-control bg-amber-50 p-4 text-sm text-amber-900">
            Pix pode levar alguns instantes. Você recebe um e-mail quando o relatório estiver pronto para ler. Pode fechar
            esta página.
          </p>
        )}
      </div>
      {(phase === "slow" || stopped) && (
        <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:justify-center">
          {stopped && (
            <button
              type="button"
              className="btn-primary"
              onClick={() => {
                setPhase("waiting");
                setRound((r) => r + 1);
              }}
            >
              Verificar de novo
            </button>
          )}
          <Link href="/minhas-analises" className="btn-secondary">Minhas análises</Link>
          <Link href="/ajuda" className="btn-secondary">Ajuda</Link>
        </div>
      )}
    </div>
  );
}
