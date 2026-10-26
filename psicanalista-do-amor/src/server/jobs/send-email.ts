import "server-only";
import { eq } from "drizzle-orm";
import { decryptField } from "@/server/crypto";
import { getDb } from "@/server/db/client";
import { conversations, reportTypes, reports, users } from "@/server/db/schema";
import { sendEmail } from "@/server/email/send";
import {
  analysisReadyEmail,
  dataDeletedEmail,
  extraReadyEmail,
  reportUnlockedEmail,
  retentionWarningEmail,
} from "@/server/email/templates";
import type { JobHandler } from "./register";

async function ownerOfConversation(conversationId: string) {
  const [row] = await getDb()
    .select({ email: users.email, conv: conversations })
    .from(conversations)
    .innerJoin(users, eq(users.id, conversations.userId))
    .where(eq(conversations.id, conversationId));
  return row ?? null;
}

async function reportContext(reportId: string) {
  const [row] = await getDb()
    .select({ report: reports, rt: reportTypes })
    .from(reports)
    .innerJoin(reportTypes, eq(reportTypes.id, reports.reportTypeId))
    .where(eq(reports.id, reportId));
  return row ?? null;
}

export const handleSendEmail: JobHandler<"send_email"> = async (job) => {
  const data = job.data;
  switch (data.template) {
    case "analysis_ready": {
      const owner = await ownerOfConversation(data.conversationId);
      if (!owner) return;
      await sendEmail({ to: owner.email, ...analysisReadyEmail(data.conversationId), template: data.template, idempotencyKey: `analysis_ready:${data.conversationId}` });
      return;
    }
    case "report_unlocked":
    case "extra_ready": {
      const ctx = await reportContext(data.reportId);
      if (!ctx) return;
      const owner = await ownerOfConversation(ctx.report.conversationId);
      if (!owner) return;
      const email =
        data.template === "report_unlocked"
          ? reportUnlockedEmail(ctx.report.conversationId)
          : extraReadyEmail(ctx.report.conversationId, ctx.rt.slug, ctx.rt.name);
      await sendEmail({ to: owner.email, ...email, template: data.template, idempotencyKey: `${data.template}:${data.reportId}` });
      return;
    }
    case "retention_warning": {
      const owner = await ownerOfConversation(data.conversationId);
      if (!owner) return;
      const deleteOn = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "long" }).format(owner.conv.expiresAt);
      await sendEmail({ to: owner.email, ...retentionWarningEmail(data.conversationId, deleteOn), template: data.template });
      return;
    }
    case "data_deleted": {
      await sendEmail({ to: decryptField(data.emailEncrypted), ...dataDeletedEmail(), template: data.template });
      return;
    }
  }
};
