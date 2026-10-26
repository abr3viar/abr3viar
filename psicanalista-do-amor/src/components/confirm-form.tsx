"use client";

import { useActionState, useState } from "react";
import { TIMEZONES, type SenderView } from "@/lib/views";

type State = { error?: string } | undefined;

const NAME_MAX = 40;

/** "1 mensagem" / "12 mensagens" (sem "(s)"). */
const messagesLabel = (n: number) => `${n.toLocaleString("pt-BR")} ${n === 1 ? "mensagem" : "mensagens"}`;

export function ConfirmForm({
  conversationId,
  senders,
  timezone,
  hasTimestamps,
  action,
}: {
  conversationId: string;
  senders: SenderView[];
  timezone: string;
  hasTimestamps: boolean;
  action: (prev: State, form: FormData) => Promise<State>;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const defaultA = senders.find((s) => s.suggested === "a") ?? senders[0]!;
  const defaultB = senders.find((s) => s.suggested === "b") ?? senders[1] ?? senders[0]!;
  const [aIndex, setAIndex] = useState(defaultA.index);
  const [bIndex, setBIndex] = useState(defaultB.index);
  // Nome digitado por remetente (QA-11): o rótulo "Sou X" acompanha o que a pessoa escreveu.
  const [names, setNames] = useState<Record<number, string>>(() =>
    Object.fromEntries(senders.map((s) => [s.index, s.label.slice(0, NAME_MAX)])),
  );
  const byIndex = new Map(senders.map((s) => [s.index, s]));
  const a = byIndex.get(aIndex)!;
  const b = byIndex.get(bIndex)!;
  const isGroup = senders.length > 2;
  const samePerson = aIndex === bIndex;
  const displayName = (index: number, fallback: string) => names[index]?.trim() || fallback;

  return (
    <form action={formAction} className="space-y-6">
      <input type="hidden" name="conversationId" value={conversationId} />
      {isGroup && (
        <div className="card space-y-3">
          <h2 className="font-semibold text-wine-900">Esta conversa tem mais de duas pessoas</h2>
          <p className="text-sm text-muted">Escolha as duas pessoas que serão analisadas.</p>
          <div className="grid gap-4 sm:grid-cols-2">
            {(["a", "b"] as const).map((slot) => (
              <label key={slot} className="block">
                <span className="label">Pessoa {slot === "a" ? 1 : 2}</span>
                <select
                  className="input"
                  value={slot === "a" ? aIndex : bIndex}
                  aria-describedby={samePerson ? "same-person" : undefined}
                  onChange={(e) => (slot === "a" ? setAIndex(Number(e.target.value)) : setBIndex(Number(e.target.value)))}
                >
                  {senders.map((s) => (
                    <option key={s.index} value={s.index}>
                      {s.label} ({messagesLabel(s.count)})
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          {samePerson && (
            <p id="same-person" role="status" className="rounded-control bg-amber-50 p-3 text-sm text-amber-900">
              Você escolheu a mesma pessoa duas vezes. Escolha duas pessoas diferentes para continuar.
            </p>
          )}
        </div>
      )}
      <input type="hidden" name="aIndex" value={aIndex} />
      <input type="hidden" name="bIndex" value={bIndex} />

      <div className="grid gap-4 sm:grid-cols-2">
        {/* Mesma pessoa escolhida duas vezes (grupo): mostra só um cartão, sem dois campos
            presos ao mesmo nome; o envio fica bloqueado até escolher outra pessoa. */}
        {(samePerson ? ([["a", a]] as const) : ([["a", a], ["b", b]] as const)).map(([slot, s]) => (
          <div key={slot} className="card space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-wine-600">
              {s.side === "right" ? "Pessoa da direita" : s.side === "left" ? "Pessoa da esquerda" : `Pessoa ${slot === "a" ? 1 : 2}`} ·{" "}
              {messagesLabel(s.count)}
            </p>
            <label className="block">
              <span className="label">Como chamar essa pessoa no relatório?</span>
              <input
                name={`${slot}Name`}
                className="input"
                value={names[s.index] ?? ""}
                onChange={(e) => {
                  const value = e.target.value;
                  setNames((prev) => ({ ...prev, [s.index]: value }));
                }}
                maxLength={NAME_MAX}
                required
              />
            </label>
            {s.samples.length > 0 && (
              <ul className="space-y-1 text-sm text-muted" aria-label="Exemplos de mensagens">
                {s.samples.map((sample, i) => (
                  <li key={i} className="rounded-lg bg-wine-50 px-3 py-2">“{sample}”</li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>

      {/* A legenda fica DENTRO do cartão (o fieldset não tem borda), nunca cortando a borda. */}
      <div className="card">
        <fieldset className="space-y-3">
          <legend className="font-semibold text-wine-900">Qual das duas é você?</legend>
          <p className="text-sm text-muted">Opcional, mas deixa o relatório mais pessoal e libera &quot;Como responder a última mensagem&quot;.</p>
          <div className="grid gap-2 sm:grid-cols-3">
            {(["a", "b", "none"] as const).map((v) => (
              <label
                key={v}
                className="flex min-h-11 cursor-pointer items-center gap-3 rounded-control border border-wine-200 bg-white px-4 py-2.5 text-sm font-medium text-ink hover:border-wine-400 has-[:checked]:border-wine-600 has-[:checked]:bg-wine-50 has-[:checked]:text-wine-900 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-wine-600"
              >
                <input type="radio" name="userIs" value={v} defaultChecked={v === "none"} className="h-4 w-4 shrink-0 accent-wine-600 focus-visible:outline-none" />
                <span className="min-w-0 break-words">
                  {v === "a" ? `Sou ${displayName(aIndex, "a Pessoa 1")}` : v === "b" ? `Sou ${displayName(bIndex, "a Pessoa 2")}` : "Prefiro não dizer"}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      </div>

      {hasTimestamps ? (
        <label className="card block">
          <span className="label">Fuso horário da conversa</span>
          <select name="timezone" defaultValue={timezone} className="input">
            {TIMEZONES.map((tz) => (
              <option key={tz.value} value={tz.value}>{tz.label}</option>
            ))}
          </select>
        </label>
      ) : (
        <input type="hidden" name="timezone" value={timezone} />
      )}

      {state?.error && <p role="alert" className="rounded-control bg-red-50 p-4 text-sm text-red-800">{state.error}</p>}
      <div className="space-y-2">
        <button
          type="submit"
          className="btn-primary min-h-12 w-full sm:w-auto"
          disabled={pending || samePerson}
          aria-describedby={samePerson ? "same-person" : undefined}
        >
          {pending ? "Enviando…" : "Confirmar e gerar relatório"}
        </button>
        {samePerson && !isGroup && (
          <p id="same-person" className="text-sm text-amber-800">Escolha duas pessoas diferentes para continuar.</p>
        )}
      </div>
    </form>
  );
}
