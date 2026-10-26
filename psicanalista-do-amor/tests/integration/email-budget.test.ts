import nodemailer from "nodemailer";
import { afterAll, afterEach, beforeEach, expect, it } from "vitest";
import { resetEnvCache } from "@/env";
import { requestMagicLink } from "@/server/auth/magic-link";
import { closeDb } from "@/server/db/client";
import { EmailBudgetError, sendEmail, setSmtpTransportForTests } from "@/server/email/send";
import { stopBoss } from "@/server/jobs/boss";
import { describeDb, prepareTestDb } from "../helpers/db";

/** S-02: orçamento diário do SMTP (Gmail bloqueia a conta acima de ~500 e-mails/dia). */
const keys = ["EMAIL_DRIVER", "SMTP_USER", "SMTP_PASSWORD", "SMTP_DAILY_LIMIT"] as const;
const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
let sent = 0;

describeDb("orçamento diário do SMTP (S-02)", () => {
  beforeEach(async () => {
    await prepareTestDb();
    Object.assign(process.env, { EMAIL_DRIVER: "smtp", SMTP_USER: "site@gmail.com", SMTP_PASSWORD: "abcdabcdabcdabcd", SMTP_DAILY_LIMIT: "5" });
    resetEnvCache();
    sent = 0;
    const transport = nodemailer.createTransport({ jsonTransport: true });
    transport.sendMail = (async () => {
      sent++;
      return { message: "{}" };
    }) as unknown as typeof transport.sendMail;
    setSmtpTransportForTests(transport);
  });
  afterEach(() => {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    setSmtpTransportForTests(undefined);
    resetEnvCache();
  });
  afterAll(async () => {
    await stopBoss();
    await closeDb();
  });

  const mail = (template: string) => ({ to: "x@example.com", subject: "s", html: "h", text: "t", template });

  it("não essenciais param em 80%; login e pagamento usam a reserva; acima do teto, recusa", async () => {
    for (let i = 0; i < 4; i++) await sendEmail(mail("analysis_ready"));
    expect(sent).toBe(4);
    // 80% de 5 = 4: o quinto aviso não essencial é descartado, sem erro (não vira tentativas).
    await sendEmail(mail("analysis_ready"));
    expect(sent).toBe(4);
    await sendEmail(mail("report_unlocked"));
    expect(sent).toBe(5);
    await expect(sendEmail(mail("report_unlocked"))).rejects.toBeInstanceOf(EmailBudgetError);
    expect(sent).toBe(5);
  });

  it("link de login com o orçamento esgotado responde como limite (\"tente mais tarde\")", async () => {
    for (let i = 0; i < 5; i++) await sendEmail(mail("magic_link"));
    expect(await requestMagicLink("pessoa@example.com", "203.0.113.7")).toEqual({ rateLimited: true });
    expect(sent).toBe(5);
  });
});
