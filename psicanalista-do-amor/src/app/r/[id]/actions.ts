"use server";

import { and, eq, sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getOwnedConversation } from "@/server/access";
import { getViewer } from "@/server/auth/session";
import { decryptJson, encryptField } from "@/server/crypto";
import { getDb } from "@/server/db/client";
import { auditLog, conversationFiles, conversations, messages, reports } from "@/server/db/schema";
import { isValidTimeZone } from "@/server/ingest/time";
import type { DetectedSender } from "@/server/ingest/normalize";
import { enqueue } from "@/server/jobs/boss";
import { getMainReportType } from "@/server/jobs/generate-main";
import { log } from "@/server/log";
import { startCheckout } from "@/server/payments/start-checkout";
import { unlockExtraWithSubscription, unlockWithSubscription } from "@/server/payments/fulfill";
import { MAIN_REPORT_SLUG } from "@/server/reports/catalog";
import { reportTypes } from "@/server/db/schema";
import { consumeRateLimit } from "@/server/rate-limit";
import { deleteConversationData } from "@/server/data-deletion";

export type ActionState = { error?: string } | undefined;

const confirmSchema = z.object({
  conversationId: z.uuid(),
  aIndex: z.coerce.number().int().min(0).max(500),
  bIndex: z.coerce.number().int().min(0).max(500),
  aName: z.string().trim().min(1).max(40),
  bName: z.string().trim().min(1).max(40),
  userIs: z.enum(["a", "b", "none"]),
  timezone: z.string().max(64),
});

/** Confirmação dos participantes (plano.md, tela 4) → enfileira o relatório principal. */
export async function confirmParticipants(_prev: ActionState, form: FormData): Promise<ActionState> {
  const parsed = confirmSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "Confira os nomes: cada um precisa ter de 1 a 40 caracteres." };
  const input = parsed.data;
  if (input.aIndex === input.bIndex) return { error: "Escolha duas pessoas diferentes." };
  if (!isValidTimeZone(input.timezone)) return { error: "Não reconhecemos esse fuso horário. Escolha um da lista e confirme de novo." };

  const viewer = await getViewer();
  const conv = await getOwnedConversation(input.conversationId, viewer);
  if (!conv) return { error: "Não encontramos esta análise. Ela pode ter sido excluída: confira em Minhas análises." };
  if (conv.status !== "needs_confirmation" || !conv.detectedSenders) {
    redirect(`/r/${conv.id}/processando`);
  }
  const senders = decryptJson(conv.detectedSenders) as DetectedSender[];
  if (!senders.some((s) => s.index === input.aIndex) || !senders.some((s) => s.index === input.bIndex)) {
    return { error: "Uma das pessoas escolhidas não está nesta conversa. Recarregue a página e escolha de novo." };
  }

  const db = getDb();
  const rt = await getMainReportType();
  await db.transaction(async (tx) => {
    // Remapeia remetentes sem decifrar mensagens (D28: sender_index).
    await tx
      .update(messages)
      .set({
        sender: sql`CASE WHEN ${messages.senderIndex} = ${input.aIndex} THEN 'a'::message_sender
                         WHEN ${messages.senderIndex} = ${input.bIndex} THEN 'b'::message_sender
                         ELSE 'other'::message_sender END`,
      })
      .where(and(eq(messages.conversationId, conv.id), sql`${messages.senderIndex} IS NOT NULL`));
    if (input.timezone !== conv.timezone) {
      // Reinterpreta os horários "de parede" no novo fuso.
      await tx
        .update(messages)
        .set({ sentAt: sql`(${messages.sentAt} AT TIME ZONE ${conv.timezone}) AT TIME ZONE ${input.timezone}` })
        .where(and(eq(messages.conversationId, conv.id), sql`${messages.sentAt} IS NOT NULL`));
    }
    await tx
      .update(conversations)
      .set({
        participantAName: encryptField(input.aName),
        participantBName: encryptField(input.bName),
        userIs: input.userIs,
        timezone: input.timezone,
        status: "generating",
        errorCode: null,
        progress: { step: "queued" },
      })
      .where(eq(conversations.id, conv.id));
    await tx
      .insert(reports)
      .values({ conversationId: conv.id, reportTypeId: rt.id, status: "queued" })
      .onConflictDoUpdate({
        target: [reports.conversationId, reports.reportTypeId],
        set: { status: "queued", errorCode: null },
      });
    await enqueue("generate_main", { conversationId: conv.id }, { tx, singletonKey: conv.id });
  });
  log.info({ conversationId: conv.id }, "participants_confirmed");
  redirect(`/r/${conv.id}/processando`);
}

/** "Tentar de novo" sem novo upload (as mensagens normalizadas já estão salvas). */
export async function reprocessConversation(form: FormData): Promise<void> {
  const id = String(form.get("conversationId") ?? "");
  const viewer = await getViewer();
  const conv = await getOwnedConversation(id, viewer);
  if (!conv || !viewer) redirect("/minhas-analises");
  if (conv.status !== "failed") redirect(`/r/${conv.id}/processando`);
  if (!(await consumeRateLimit("reprocess", [`user:${viewer.userId}`]))) {
    redirect(`/r/${conv.id}/processando?erro=rate_limited`);
  }
  const db = getDb();
  if (conv.participantAName && conv.messageCount > 0) {
    await db.transaction(async (tx) => {
      await tx.update(conversations).set({ status: "generating", errorCode: null, progress: { step: "queued" } }).where(eq(conversations.id, conv.id));
      await tx.update(reports).set({ status: "queued", errorCode: null }).where(and(eq(reports.conversationId, conv.id), eq(reports.status, "failed")));
      await enqueue("generate_main", { conversationId: conv.id }, { tx, singletonKey: conv.id });
    });
  } else {
    const [pending] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(conversationFiles)
      .where(and(eq(conversationFiles.conversationId, conv.id), sql`${conversationFiles.purgedAt} IS NULL`));
    if (!pending?.n) redirect(`/analisar?erro=files_missing`);
    await db.transaction(async (tx) => {
      await tx.update(conversations).set({ status: "uploaded", errorCode: null, progress: { step: "received" } }).where(eq(conversations.id, conv.id));
      await enqueue("ingest", { conversationId: conv.id }, { tx, singletonKey: conv.id });
    });
  }
  redirect(`/r/${conv.id}/processando`);
}

/** Exclusão de uma análise pelo usuário (exclusão real em cascata + storage). */
export async function deleteConversation(form: FormData): Promise<void> {
  const id = String(form.get("conversationId") ?? "");
  const viewer = await getViewer();
  const conv = await getOwnedConversation(id, viewer);
  if (!conv || !viewer) redirect("/minhas-analises");
  // Só com o passo de confirmação (QA-03): um clique acidental não apaga nada.
  if (form.get("confirm") !== "sim") redirect(`/r/${conv.id}`);
  await deleteConversationData(conv.id);
  await getDb().insert(auditLog).values({ userId: viewer.userId, action: "conversation.deleted", targetId: conv.id });
  redirect("/minhas-analises?excluida=1");
}

/** Cria a purchase e redireciona para o Payment Link (plano.md 6.2). */
export async function startCheckoutAction(form: FormData): Promise<void> {
  const conversationId = String(form.get("conversationId") ?? "");
  const slug = String(form.get("slug") ?? "");
  const viewer = await getViewer();
  if (!viewer) redirect("/entrar");
  const result = await startCheckout(viewer, conversationId, slug);
  if (result.ok) redirect(result.url);
  if (result.redirectTo) redirect(result.redirectTo);
  redirect(`/r/${conversationId}?erro=${result.error}`);
}

/**
 * Libera o relatório principal pela assinatura (D96). Exige sessão VERIFICADA: uma sessão
 * criada no envio, só com o e-mail digitado, nunca usa a assinatura desse e-mail.
 */
export async function unlockWithSubscriptionAction(form: FormData): Promise<void> {
  const conversationId = String(form.get("conversationId") ?? "");
  const viewer = await getViewer();
  if (!viewer?.verified) redirect("/entrar");
  const conv = await getOwnedConversation(conversationId, viewer);
  if (!conv) redirect("/minhas-analises");
  const [main] = await getDb()
    .select({ id: reports.id })
    .from(reports)
    .innerJoin(reportTypes, eq(reportTypes.id, reports.reportTypeId))
    .where(and(eq(reports.conversationId, conv.id), eq(reportTypes.slug, MAIN_REPORT_SLUG)));
  if (!main) redirect(`/r/${conv.id}`);
  const result = await unlockWithSubscription(viewer.userId, main.id);
  if (result.ok || result.reason === "already_unlocked") redirect(`/r/${conv.id}`);
  redirect(`/r/${conv.id}?erro=${result.reason === "limit_reached" ? "subscription_limit" : result.reason === "no_subscription" ? "subscription_inactive" : "not_ready"}#desbloquear`);
}

/** Relatório adicional incluído na assinatura (D96): cria e enfileira, sem cobrança. */
export async function unlockExtraWithSubscriptionAction(form: FormData): Promise<void> {
  const conversationId = String(form.get("conversationId") ?? "");
  const slug = String(form.get("slug") ?? "");
  const viewer = await getViewer();
  if (!viewer?.verified) redirect("/entrar");
  const conv = await getOwnedConversation(conversationId, viewer);
  if (!conv || !/^[a-z0-9-]{1,64}$/.test(slug)) redirect("/minhas-analises");
  const result = await unlockExtraWithSubscription(viewer.userId, conv.id, slug);
  if (result.ok || result.reason === "already_unlocked") redirect(`/r/${conv.id}/extra/${slug}`);
  if (result.reason === "needs_user_side") redirect(`/r/${conv.id}#extras`);
  redirect(`/r/${conv.id}?erro=${result.reason === "no_subscription" ? "subscription_inactive" : "not_ready"}#extras`);
}
