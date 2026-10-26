"use client";

import { useActionState } from "react";

type State = { sent?: boolean; error?: string } | undefined;

export function LoginForm({ action }: { action: (prev: State, form: FormData) => Promise<State> }) {
  const [state, formAction, pending] = useActionState(action, undefined);
  if (state?.sent) {
    return (
      <p role="status" className="rounded-xl bg-green-50 p-4 text-green-900">
        Se houver análises com esse e-mail, enviamos um link de acesso. Ele vale por 15 minutos. Confira também a caixa de spam.
      </p>
    );
  }
  return (
    <form action={formAction} className="space-y-4">
      <label className="block">
        <span className="label">Seu e-mail</span>
        <input type="email" name="email" required autoComplete="email" className="input" placeholder="voce@exemplo.com" />
      </label>
      {state?.error && <p role="alert" className="text-sm text-red-700">{state.error}</p>}
      <button className="btn-primary" type="submit" disabled={pending}>
        {pending ? "Enviando…" : "Receber link de acesso"}
      </button>
    </form>
  );
}
