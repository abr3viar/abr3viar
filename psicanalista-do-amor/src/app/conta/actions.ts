"use server";

import { redirect } from "next/navigation";
import { getViewer, destroySession } from "@/server/auth/session";
import { encryptField } from "@/server/crypto";
import { getDb } from "@/server/db/client";
import { auditLog } from "@/server/db/schema";
import { deleteUserData } from "@/server/data-deletion";
import { enqueue } from "@/server/jobs/boss";
import { recordAccess } from "@/server/access-log";
import { billingPortalUrl, cancelUserSubscriptions } from "@/server/payments/subscriptions";
import { startSubscriptionCheckout } from "@/server/payments/start-checkout";

/** Exclui TODOS os dados do usuário (exige sessão verificada e confirmação digitada). */
export async function deleteAllDataAction(form: FormData): Promise<void> {
  const viewer = await getViewer();
  if (!viewer?.verified) redirect("/entrar");
  if (String(form.get("confirm") ?? "").trim().toUpperCase() !== "EXCLUIR") redirect("/conta?erro=confirmacao");
  // Sem cancelar a assinatura no Stripe, a conta excluída continuaria sendo cobrada (D96).
  const canceled = await cancelUserSubscriptions(viewer.userId);
  if (!canceled.ok) redirect("/conta?erro=assinatura");
  // Marco Civil, art. 15: o registro de acesso fica por 6 meses, mesmo com a conta excluída.
  await recordAccess("account_deletion", viewer.userId);
  await deleteUserData(viewer.userId);
  await getDb().insert(auditLog).values({ userId: viewer.userId, action: "data.deleted" });
  await enqueue("send_email", { template: "data_deleted", emailEncrypted: encryptField(viewer.email) });
  await destroySession();
  redirect("/?dados-excluidos=1");
}

/** Abre o portal do cliente do Stripe (cartão, faturas e cancelamento da assinatura). */
export async function openBillingPortalAction(): Promise<void> {
  const viewer = await getViewer();
  if (!viewer?.verified) redirect("/entrar");
  const url = await billingPortalUrl(viewer.userId);
  redirect(url ?? "/conta?erro=portal");
}

/** Assinar (D96): exige sessão verificada; quem ativa é o webhook. */
export async function startSubscriptionAction(): Promise<void> {
  const viewer = await getViewer();
  if (!viewer?.verified) redirect("/entrar?assinar=1");
  const result = await startSubscriptionCheckout(viewer);
  if (result.ok) redirect(result.url);
  if (result.error === "already_subscribed" || result.error === "subscription_pending") redirect("/conta#assinatura");
  redirect(`/assinatura?erro=${result.error}`);
}
