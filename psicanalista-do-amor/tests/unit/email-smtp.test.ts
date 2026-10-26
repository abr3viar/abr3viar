import nodemailer, { type SendMailOptions } from "nodemailer";
import { afterEach, describe, expect, it, vi } from "vitest";
import { emailFrom, getEnv, resetEnvCache } from "@/env";
import { sendEmail, setSmtpTransportForTests } from "@/server/email/send";
import { log } from "@/server/log";

// Envio por SMTP (Gmail) sem domínio próprio. Nenhum e-mail real: o transporte é falso.
// O orçamento diário (S-02) usa o Postgres; aqui é simulado (teste próprio em tests/integration).
vi.mock("@/server/rate-limit", () => ({ consumeGlobalSlot: async () => true }));

const touched = [
  "NODE_ENV",
  "APP_URL",
  "EMAIL_DRIVER",
  "EMAIL_FROM",
  "SMTP_USER",
  "SMTP_PASSWORD",
  "SMTP_PORT",
  "SUPPORT_EMAIL",
  "DATABASE_SSL",
  "RESEND_API_KEY",
  "ALLOW_LOCAL_STORAGE_IN_PRODUCTION",
] as const;
const saved = Object.fromEntries(touched.map((k) => [k, process.env[k]]));

afterEach(() => {
  const env = process.env as Record<string, string | undefined>;
  for (const k of touched) {
    if (saved[k] === undefined) delete env[k];
    else env[k] = saved[k];
  }
  setSmtpTransportForTests(undefined);
  vi.restoreAllMocks();
  resetEnvCache();
});

function useSmtp(extra: Record<string, string> = {}) {
  Object.assign(process.env, { EMAIL_DRIVER: "smtp", SMTP_USER: "psicanalista.teste@gmail.com", SMTP_PASSWORD: "abcd efgh ijkl mnop", ...extra });
  resetEnvCache();
}

function useProduction() {
  Object.assign(process.env, {
    NODE_ENV: "production",
    APP_URL: "https://psicanalistadoamor.squareweb.app",
    SUPPORT_EMAIL: "suporte.teste@gmail.com",
    DATABASE_SSL: "require",
    ALLOW_LOCAL_STORAGE_IN_PRODUCTION: "1",
  });
}

function envError(): string {
  try {
    getEnv();
    return "";
  } catch (err) {
    return (err as Error).message;
  }
}

describe("EMAIL_DRIVER=smtp: validação", () => {
  it("exige SMTP_USER e SMTP_PASSWORD", () => {
    Object.assign(process.env, { EMAIL_DRIVER: "smtp" });
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASSWORD;
    resetEnvCache();
    const msg = envError();
    expect(msg).toContain("SMTP_USER");
    expect(msg).toContain("SMTP_PASSWORD");
  });

  it("vale em produção sem domínio próprio e sem Resend; remetente padrão é a conta do SMTP", () => {
    useProduction();
    delete process.env.RESEND_API_KEY;
    delete process.env.EMAIL_FROM;
    useSmtp();
    expect(envError()).toBe("");
    expect(getEnv().SMTP_HOST).toBe("smtp.gmail.com");
    expect(getEnv().SMTP_PORT).toBe(465);
    expect(emailFrom()).toBe("Psicanalista do Amor <psicanalista.teste@gmail.com>");
  });

  it("recusa em produção o remetente de exemplo e Resend sem EMAIL_FROM", () => {
    useProduction();
    useSmtp({ EMAIL_FROM: "Psicanalista do Amor <oi@example.com>" });
    expect(envError()).toContain("EMAIL_FROM");

    delete process.env.EMAIL_FROM;
    Object.assign(process.env, { EMAIL_DRIVER: "resend", RESEND_API_KEY: "re_teste" });
    resetEnvCache();
    expect(envError()).toContain("EMAIL_FROM");
  });

  it("sem EMAIL_FROM, SMTP_USER precisa ser um e-mail (vira o remetente)", () => {
    useSmtp({ SMTP_USER: "psicanalista.teste" });
    expect(envError()).toContain("SMTP_USER");
  });

  it("a mensagem de erro nunca mostra a senha", () => {
    useSmtp({ SMTP_PORT: "abc" });
    const msg = envError();
    expect(msg).toContain("SMTP_PORT");
    expect(msg).not.toContain("abcd efgh");
  });
});

describe("EMAIL_DRIVER=smtp: envio", () => {
  it("envia com remetente, destinatário e Message-ID estável por chave de idempotência", async () => {
    useSmtp();
    const transport = nodemailer.createTransport({ jsonTransport: true });
    const sent: Array<{ from: unknown; to: unknown; messageId: unknown; subject: unknown }> = [];
    const original = transport.sendMail.bind(transport);
    transport.sendMail = (async (mail: SendMailOptions) => {
      const info = await original(mail);
      const parsed = JSON.parse(String(info.message)) as { from: unknown; to: unknown; messageId: unknown; subject: unknown };
      sent.push(parsed);
      return info;
    }) as typeof transport.sendMail;
    setSmtpTransportForTests(transport);

    const email = { to: "cliente@example.com", subject: "Seu link", html: "<p>oi</p>", text: "oi", template: "magic_link", idempotencyKey: "report_unlocked:rel-xyz" };
    await sendEmail(email);
    await sendEmail(email);

    expect(sent).toHaveLength(2);
    expect(JSON.stringify(sent[0]?.from)).toContain("psicanalista.teste@gmail.com");
    expect(JSON.stringify(sent[0]?.to)).toContain("cliente@example.com");
    expect(sent[0]?.messageId).toMatch(/^<[0-9a-f]{32}@localhost>$/);
    expect(sent[0]?.messageId).toBe(sent[1]?.messageId);
    // A chave (com o ID do relatório) não aparece em texto claro no cabeçalho.
    expect(String(sent[0]?.messageId)).not.toContain("xyz");
  });

  it("falha de autenticação vira erro genérico, sem detalhes do servidor", async () => {
    useSmtp();
    const transport = nodemailer.createTransport({ jsonTransport: true });
    transport.sendMail = (async () => {
      throw Object.assign(new Error("535 Username and Password not accepted for cliente@example.com"), { code: "EAUTH" });
    }) as typeof transport.sendMail;
    setSmtpTransportForTests(transport);
    const warn = vi.spyOn(log, "warn").mockImplementation(() => undefined);
    await expect(sendEmail({ to: "cliente@example.com", subject: "x", html: "x", text: "x", template: "magic_link" })).rejects.toThrow(/^email_send_failed$/);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toEqual({ template: "magic_link", code: "EAUTH" });
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).not.toContain("cliente@example.com");
    expect(logged).not.toContain("535");
  });
});
