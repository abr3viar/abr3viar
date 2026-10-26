import { z } from "zod";

/**
 * Validação das variáveis de ambiente (plano.md, seção 9).
 *
 * A validação é preguiçosa (`getEnv()`): o `next build` não precisa dos segredos,
 * mas qualquer código de servidor que use uma variável falha cedo e com mensagem
 * clara (sem imprimir valores) se algo estiver faltando.
 */

const base64Key32 = z
  .string()
  .min(1)
  .refine((v) => {
    try {
      return Buffer.from(v, "base64").length === 32;
    } catch {
      return false;
    }
  }, "precisa ter 32 bytes codificados em base64");

const intFromEnv = (def: number) =>
  z.preprocess(
    (v) => (v === undefined || v === "" ? def : Number(v)),
    z.number().int().positive(),
  );

const optionalString = z.preprocess((v) => (v === "" ? undefined : v), z.string().optional());

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    APP_URL: z.url(),
    DATABASE_URL: z.string().min(1),
    DATABASE_SSL: z.enum(["require", "no-verify", "disable"]).optional(),
    /** PEM (chave privada + certificado do cliente) em base64 — ex.: certificado do Postgres da Square Cloud. */
    DATABASE_SSL_CERT_BASE64: optionalString,
    /**
     * Alternativa: caminho (relativo à raiz do app) do arquivo PEM do certificado. É o que o
     * MCP da Square Cloud grava (`conectar_banco_app` envia `certificate.pem`). Base64 tem prioridade.
     */
    DATABASE_URL_CERT_PATH: optionalString,
    /** CA do servidor em base64 (PEM), para verificar o certificado do banco. */
    DATABASE_SSL_CA_BASE64: optionalString,
    /** Máximo de conexões por processo (site e worker têm pools próprios). */
    DATABASE_POOL_MAX: intFromEnv(10),
    DATA_ENCRYPTION_KEY: base64Key32,
    DATA_ENCRYPTION_KEY_PREVIOUS: z.preprocess(
      (v) => (v === "" ? undefined : v),
      base64Key32.optional(),
    ),
    SESSION_SECRET: z.string().min(32, "use pelo menos 32 caracteres"),
    HASH_PEPPER: z.string().min(16, "use pelo menos 16 caracteres"),

    GROQ_API_KEY: z.string().min(1),
    GROQ_BASE_URL: optionalString,
    GROQ_VISION_MODEL: z.string().min(1),
    GROQ_REPORT_MODEL: z.string().min(1),
    GROQ_SUMMARY_MODEL: z.string().min(1),
    GROQ_REASONING_EFFORT: z.enum(["off", "none", "default", "low", "medium", "high"]).default("medium"),
    GROQ_VISION_MAX_IMAGES_PER_REQUEST: intFromEnv(3),
    GROQ_MAX_CONCURRENCY: intFromEnv(2),
    GROQ_REPORT_MAX_COMPLETION_TOKENS: intFromEnv(8000),
    REPORT_DIRECT_MAX_TOKENS: intFromEnv(40000),
    CHUNK_TOKENS: intFromEnv(12000),

    STRIPE_SECRET_KEY: z.string().min(1),
    STRIPE_WEBHOOK_SECRET: z.string().min(1),
    /** Taxa do Stripe repassada ao cliente (cartão nacional). Confira as tarifas da sua conta. */
    STRIPE_FEE_PERCENT: z.preprocess((v) => (v === undefined ? 3.99 : Number(String(v).replace(",", "."))), z.number().min(0).max(20)),
    STRIPE_FEE_FIXED_CENTS: z.preprocess((v) => (v === undefined ? 39 : Number(v)), z.number().int().min(0).max(1000)),
    /** Tarifa extra do Stripe Billing sobre cobranças recorrentes (só na assinatura, D96). Confira a sua conta. */
    STRIPE_SUBSCRIPTION_EXTRA_FEE_PERCENT: z.preprocess((v) => (v === undefined ? 0 : Number(String(v).replace(",", "."))), z.number().min(0).max(5)),

    STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
    STORAGE_LOCAL_DIR: z.string().default("./.data/uploads"),
    S3_ENDPOINT: optionalString,
    S3_REGION: z.string().default("auto"),
    S3_BUCKET: optionalString,
    S3_ACCESS_KEY_ID: optionalString,
    S3_SECRET_ACCESS_KEY: optionalString,
    /** "1" permite STORAGE_DRIVER=local em produção (Square Cloud: disco do próprio app). */
    ALLOW_LOCAL_STORAGE_IN_PRODUCTION: z.enum(["0", "1"]).default("0"),

    /** "smtp" (ex.: Gmail, funciona sem domínio próprio), "resend" (exige domínio verificado) ou "outbox" (dev/testes). */
    EMAIL_DRIVER: z.enum(["smtp", "resend", "outbox"]).default("smtp"),
    RESEND_API_KEY: optionalString,
    SMTP_HOST: z.string().min(1).default("smtp.gmail.com"),
    SMTP_PORT: intFromEnv(465),
    SMTP_USER: optionalString,
    /** Gmail: a "senha de app" de 16 letras (não é a senha da conta). */
    SMTP_PASSWORD: z.preprocess((v) => (typeof v === "string" ? v.trim() || undefined : v), z.string().optional()),
    /** Remetente. Vazio com EMAIL_DRIVER=smtp: usa "Psicanalista do Amor <SMTP_USER>". */
    EMAIL_FROM: z.preprocess((v) => (v === "" ? undefined : v), z.string().min(3).optional()),
    EMAIL_OUTBOX_DIR: z.string().default("./.data/outbox"),
    /**
     * Orçamento diário de e-mails pelo SMTP (S-02): o Gmail bloqueia a conta por até 24 h
     * acima de ~500/dia. Os não essenciais param em 80%; link de login e "relatório liberado"
     * usam o resto.
     */
    SMTP_DAILY_LIMIT: intFromEnv(450),

    UPLOAD_MAX_BYTES: intFromEnv(26_214_400),
    MAX_IMAGES: intFromEnv(60),
    MAX_IMAGE_BYTES: intFromEnv(8 * 1024 * 1024),
    PASTE_MAX_CHARS: intFromEnv(500_000),
    /** Teto de envios por hora no site inteiro (protege a cota da Groq contra abuso). */
    UPLOAD_GLOBAL_MAX_PER_HOUR: intFromEnv(120),
    RETENTION_UNPAID_DAYS: intFromEnv(7),
    RETENTION_PAID_DAYS: intFromEnv(180),
    ADMIN_EMAILS: z.string().default(""),
    /** Contatos públicos exibidos em Ajuda/Termos (suporte) e Privacidade (encarregado/DPO). */
    SUPPORT_EMAIL: z.preprocess((v) => (v === "" ? undefined : v), z.email().optional()),
    PRIVACY_EMAIL: z.preprocess((v) => (v === "" ? undefined : v), z.email().optional()),
    /** "1" depois da revisão jurídica: some o aviso "texto em revisão" de Termos e Privacidade. */
    LEGAL_REVIEW_DONE: z.preprocess((v) => (typeof v === "string" && /^(1|true|sim|yes)$/i.test(v.trim()) ? "1" : "0"), z.enum(["0", "1"])),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
    PROCESS_TYPE: z.enum(["web", "worker", "all"]).default("all"),
    /** Proxies confiáveis na frente do app (contados do fim do X-Forwarded-For). */
    TRUSTED_PROXY_HOPS: intFromEnv(1),
    /** Webhook (Discord/Slack) para alertas operacionais sem dados pessoais. */
    ALERT_WEBHOOK_URL: z.preprocess((v) => (v === "" ? undefined : v), z.url().optional()),
  })
  .superRefine((env, ctx) => {
    if (env.STORAGE_DRIVER === "s3") {
      for (const key of ["S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"] as const) {
        if (!env[key]) {
          ctx.addIssue({ code: "custom", path: [key], message: "obrigatória com STORAGE_DRIVER=s3" });
        }
      }
    }
    if (env.EMAIL_DRIVER === "resend" && !env.RESEND_API_KEY) {
      ctx.addIssue({
        code: "custom",
        path: ["RESEND_API_KEY"],
        message: "obrigatória com EMAIL_DRIVER=resend",
      });
    }
    if (env.EMAIL_DRIVER === "smtp") {
      for (const key of ["SMTP_USER", "SMTP_PASSWORD"] as const) {
        if (!env[key]) {
          ctx.addIssue({ code: "custom", path: [key], message: "obrigatória com EMAIL_DRIVER=smtp" });
        }
      }
      if (env.SMTP_USER && !env.EMAIL_FROM && !z.email().safeParse(env.SMTP_USER).success) {
        ctx.addIssue({ code: "custom", path: ["SMTP_USER"], message: "use o endereço Gmail inteiro (ex.: nome@gmail.com)" });
      }
    }
    if (env.NODE_ENV === "production") {
      if (env.EMAIL_DRIVER === "resend" && !env.EMAIL_FROM) {
        ctx.addIssue({ code: "custom", path: ["EMAIL_FROM"], message: "obrigatória com EMAIL_DRIVER=resend (remetente do domínio verificado)" });
      }
      if (env.EMAIL_FROM && /@example\.(com|org|net)\b/i.test(env.EMAIL_FROM)) {
        ctx.addIssue({ code: "custom", path: ["EMAIL_FROM"], message: "ainda está com o remetente de exemplo" });
      }
      if (!env.APP_URL.startsWith("https://")) {
        ctx.addIssue({ code: "custom", path: ["APP_URL"], message: "use o endereço com https:// em produção" });
      }
      if (!env.SUPPORT_EMAIL) {
        ctx.addIssue({ code: "custom", path: ["SUPPORT_EMAIL"], message: "obrigatória em produção (contato de suporte e reembolso)" });
      }
      // TLS do banco precisa ser uma escolha explícita em produção (DATABASE_SSL ou ?sslmode= na URL).
      let urlSslMode: string | null = null;
      try {
        urlSslMode = new URL(env.DATABASE_URL).searchParams.get("sslmode");
      } catch {
        urlSslMode = null;
      }
      if (!env.DATABASE_SSL && !urlSslMode) {
        ctx.addIssue({
          code: "custom",
          path: ["DATABASE_SSL"],
          message: "defina no-verify, require ou disable (ou ?sslmode= na DATABASE_URL) — ver DEPLOY.md",
        });
      }
      // Impede subir em produção com os valores de exemplo do .env.example.
      const placeholders = [
        "DATA_ENCRYPTION_KEY",
        "SESSION_SECRET",
        "HASH_PEPPER",
        "GROQ_API_KEY",
        "STRIPE_SECRET_KEY",
        "STRIPE_WEBHOOK_SECRET",
      ] as const;
      for (const key of placeholders) {
        const value = env[key];
        const decoded = key === "DATA_ENCRYPTION_KEY" ? Buffer.from(value, "base64").toString("latin1") : value;
        if (/fake|troque/i.test(decoded)) {
          ctx.addIssue({ code: "custom", path: [key], message: "ainda está com o valor de exemplo" });
        }
      }
      if (env.EMAIL_DRIVER === "outbox") {
        ctx.addIssue({
          code: "custom",
          path: ["EMAIL_DRIVER"],
          message: "outbox é só para desenvolvimento/testes",
        });
      }
      if (env.STORAGE_DRIVER === "local" && env.ALLOW_LOCAL_STORAGE_IN_PRODUCTION !== "1") {
        ctx.addIssue({
          code: "custom",
          path: ["STORAGE_DRIVER"],
          message: "use s3 em produção (ou ALLOW_LOCAL_STORAGE_IN_PRODUCTION=1 com disco persistente)",
        });
      }
    }
  });

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

export function getEnv(): Env {
  if (cached) return cached;
  // Variáveis vazias ("FOO=") contam como ausentes.
  const raw = Object.fromEntries(
    Object.entries(process.env).filter(([, v]) => v !== undefined && v !== ""),
  );
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    // Mostra só os nomes das variáveis e o problema, nunca os valores.
    const problems = parsed.error.issues
      .map((i) => `  - ${i.path.join(".") || "(raiz)"}: ${i.message}`)
      .join("\n");
    const err = new Error(`Variáveis de ambiente inválidas ou ausentes:\n${problems}`);
    err.name = "EnvError";
    throw err;
  }
  cached = parsed.data;
  return cached;
}

/** Só para testes: força nova leitura de process.env. */
export function resetEnvCache(): void {
  cached = undefined;
}

export function adminEmails(): string[] {
  return getEnv()
    .ADMIN_EMAILS.split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/** E-mails de contato públicos (nulos enquanto não configurados). */
export function contactEmails(): { support: string | null; privacy: string | null } {
  try {
    const env = getEnv();
    return { support: env.SUPPORT_EMAIL ?? null, privacy: env.PRIVACY_EMAIL ?? env.SUPPORT_EMAIL ?? null };
  } catch {
    return { support: null, privacy: null };
  }
}

/** Termos e Privacidade já passaram pela revisão jurídica? */
export function legalReviewDone(): boolean {
  try {
    return getEnv().LEGAL_REVIEW_DONE === "1";
  } catch {
    return false;
  }
}

/** Remetente efetivo dos e-mails (com SMTP, o próprio usuário da conta se EMAIL_FROM estiver vazio). */
export function emailFrom(): string {
  const env = getEnv();
  if (env.EMAIL_FROM) return env.EMAIL_FROM;
  if (env.SMTP_USER) return `Psicanalista do Amor <${env.SMTP_USER}>`;
  return "Psicanalista do Amor <oi@example.com>";
}

/** Operador de e-mail citado na Política de Privacidade (segue o driver configurado). */
export function emailProvider(): string {
  try {
    const env = getEnv();
    if (env.EMAIL_DRIVER === "resend") return "Resend (EUA)";
    if (/(^|\.)(gmail|googlemail|google)\.com$/i.test(env.SMTP_HOST)) return "Google — Gmail (EUA)";
    return "Provedor de e-mail contratado";
  } catch {
    return "Provedor de e-mail contratado";
  }
}

export function stripeFees(): { percent: number; fixedCents: number } {
  const env = getEnv();
  return { percent: env.STRIPE_FEE_PERCENT, fixedCents: env.STRIPE_FEE_FIXED_CENTS };
}

/** Taxa usada no preço cobrado de um tipo do catálogo: a assinatura soma a tarifa do Stripe Billing. */
export function stripeFeesFor(kind: string): { percent: number; fixedCents: number } {
  const fees = stripeFees();
  if (kind !== "subscription") return fees;
  return { ...fees, percent: fees.percent + getEnv().STRIPE_SUBSCRIPTION_EXTRA_FEE_PERCENT };
}

export function isStripeLiveMode(): boolean {
  return getEnv().STRIPE_SECRET_KEY.startsWith("sk_live_") || getEnv().STRIPE_SECRET_KEY.startsWith("rk_live_");
}
