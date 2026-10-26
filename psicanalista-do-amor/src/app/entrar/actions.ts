"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { consumeMagicLink, requestMagicLink } from "@/server/auth/magic-link";
import { destroyAllSessions, destroySession, getViewer } from "@/server/auth/session";
import { getClientIp, getUserAgent } from "@/server/http";

export type LoginState = { sent?: boolean; error?: string } | undefined;

export async function requestLoginAction(_prev: LoginState, form: FormData): Promise<LoginState> {
  const parsed = z.email().max(254).safeParse(String(form.get("email") ?? "").trim());
  if (!parsed.success) return { error: "Digite um e-mail válido." };
  const { rateLimited } = await requestMagicLink(parsed.data, await getClientIp());
  if (rateLimited) return { error: "Muitos pedidos em pouco tempo. Aguarde alguns minutos." };
  // Mesma resposta exista ou não a conta (sem enumeração).
  return { sent: true };
}

export async function verifyLoginAction(form: FormData): Promise<void> {
  const token = String(form.get("token") ?? "");
  const ok = await consumeMagicLink(token, await getUserAgent());
  redirect(ok ? "/minhas-analises" : "/entrar?erro=link");
}

export async function logoutAction(): Promise<void> {
  await destroySession();
  redirect("/");
}

/** Sai de todos os aparelhos (exige sessão verificada: uma leve não derruba as do dono). */
export async function logoutEverywhereAction(): Promise<void> {
  const viewer = await getViewer();
  if (!viewer?.verified) redirect("/entrar");
  await destroyAllSessions(viewer.userId);
  redirect("/entrar?saiu=todos");
}
