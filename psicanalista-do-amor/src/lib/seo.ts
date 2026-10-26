import type { Metadata } from "next";

/** Páginas com dados do usuário (ou fluxo privado): nunca indexar nem seguir links. */
export const PRIVATE_ROBOTS: NonNullable<Metadata["robots"]> = {
  index: false,
  follow: false,
  nocache: true,
  googleBot: { index: false, follow: false },
};

/** Páginas públicas (landing, ajuda, termos, privacidade): indexação é opt-in. */
export const PUBLIC_ROBOTS: NonNullable<Metadata["robots"]> = { index: true, follow: true };

/** Endereço público em tempo de execução (o build não conhece o APP_URL de produção). */
export function appUrl(): string {
  return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");
}
