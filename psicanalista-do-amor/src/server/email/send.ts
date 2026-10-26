import "server-only";
import { createHash } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import nodemailer, { type Transporter } from "nodemailer";
import { Resend } from "resend";
import { emailFrom, getEnv } from "@/env";
import { log } from "@/server/log";
import { randomToken } from "@/server/crypto";
import { sendAlert } from "@/server/alerts";
import { consumeGlobalSlot } from "@/server/rate-limit";

export type OutgoingEmail = {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Chave de idempotência (ex.: "report_unlocked:<id>"). */
  idempotencyKey?: string;
  /** Rótulo para logs (nunca o destinatário). */
  template: string;
};

const holder = globalThis as unknown as { __pdaResend?: Resend; __pdaSmtp?: Transporter };

/** Orçamento diário do SMTP esgotado (S-02): link de login responde "tente mais tarde". */
export class EmailBudgetError extends Error {
  constructor() {
    super("email_daily_budget_exhausted");
    this.name = "EmailBudgetError";
  }
}

/** E-mails que usam a reserva final do orçamento (login e pagamento confirmado). */
const ESSENTIAL_TEMPLATES = new Set(["magic_link", "report_unlocked", "data_deleted"]);

/**
 * Reserva um envio no orçamento diário do SMTP (contador no Postgres, compartilhado por site e
 * worker). Reaproveita a ação "login_email" da tabela de limites com escopo próprio (sem migration).
 */
async function reserveSmtpSlot(template: string): Promise<"ok" | "skip"> {
  const limit = getEnv().SMTP_DAILY_LIMIT;
  const essential = ESSENTIAL_TEMPLATES.has(template);
  const max = essential ? limit : Math.floor(limit * 0.8);
  if (await consumeGlobalSlot("login_email", max, { windowSec: 86_400, scope: "smtp_daily" })) return "ok";
  log.warn({ template, code: "email_daily_budget" }, "email_skipped_daily_budget");
  await sendAlert("orcamento_diario_de_email", { limite: limit, modelo: template });
  if (!essential) return "skip";
  throw new EmailBudgetError();
}

/** Só para testes: troca o transporte SMTP (nunca enviar e-mail real nos testes). */
export function setSmtpTransportForTests(transport: Transporter | undefined): void {
  holder.__pdaSmtp = transport;
}

function smtpTransport(): Transporter {
  const env = getEnv();
  holder.__pdaSmtp ??= nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    // 465 = TLS direto; 587 = STARTTLS (obrigatório, nunca texto puro).
    secure: env.SMTP_PORT === 465,
    requireTLS: env.SMTP_PORT !== 465,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD },
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
  });
  return holder.__pdaSmtp;
}

/**
 * Message-ID fixo por chave de idempotência: se o job repetir o envio, o provedor de
 * e-mail do destinatário tende a tratar como a mesma mensagem. O ID vai como hash.
 */
function messageIdFor(key: string): string {
  const host = new URL(getEnv().APP_URL).hostname || "localhost";
  const hash = createHash("sha256").update(key).digest("hex").slice(0, 32);
  return `<${hash}@${host}>`;
}

export async function sendEmail(email: OutgoingEmail): Promise<void> {
  const env = getEnv();
  if (env.EMAIL_DRIVER === "outbox") {
    // Desenvolvimento/testes: grava o e-mail num arquivo local (pasta no .gitignore).
    const dir = path.resolve(env.EMAIL_OUTBOX_DIR);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const file = path.join(dir, `${Date.now()}-${randomToken(6)}.json`);
    // Grava em arquivo temporário e renomeia: quem lê nunca vê um JSON pela metade.
    await writeFile(`${file}.tmp`, JSON.stringify(email, null, 2), { mode: 0o600 });
    await rename(`${file}.tmp`, file);
    log.info({ template: email.template }, "email_written_to_outbox");
    return;
  }
  if (env.EMAIL_DRIVER === "smtp") {
    // Avisos não essenciais (ex.: "análise pronta") são descartados sem novas tentativas.
    if ((await reserveSmtpSlot(email.template)) === "skip") return;
    try {
      await smtpTransport().sendMail({
        from: emailFrom(),
        to: email.to,
        subject: email.subject,
        html: email.html,
        text: email.text,
        ...(email.idempotencyKey ? { messageId: messageIdFor(email.idempotencyKey) } : {}),
      });
    } catch (err) {
      // Só o código do erro (ex.: EAUTH): a mensagem do servidor pode citar o destinatário.
      const code = typeof err === "object" && err !== null && "code" in err ? String((err as { code: unknown }).code) : "unknown";
      log.warn({ template: email.template, code }, "email_send_failed");
      throw new Error("email_send_failed");
    }
    log.info({ template: email.template }, "email_sent");
    return;
  }
  holder.__pdaResend ??= new Resend(env.RESEND_API_KEY);
  const { error } = await holder.__pdaResend.emails.send(
    { from: emailFrom(), to: email.to, subject: email.subject, html: email.html, text: email.text },
    email.idempotencyKey ? { idempotencyKey: email.idempotencyKey } : undefined,
  );
  if (error) {
    log.warn({ template: email.template, code: error.name }, "email_send_failed");
    throw new Error("email_send_failed");
  }
  log.info({ template: email.template }, "email_sent");
}
