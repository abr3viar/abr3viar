"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";

/**
 * Botão de envio que mostra o estado "enviando" do formulário pai (server action) e evita
 * toque duplo. Client só para ler `useFormStatus`.
 */
export function SubmitButton({
  children,
  pendingLabel,
  className,
  disabled,
  name,
  value,
}: {
  children: ReactNode;
  pendingLabel?: string;
  className?: string;
  disabled?: boolean;
  name?: string;
  value?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" name={name} value={value} className={className} disabled={disabled || pending} aria-busy={pending || undefined}>
      {pending && pendingLabel ? pendingLabel : children}
    </button>
  );
}
