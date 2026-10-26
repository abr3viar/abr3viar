/**
 * Schema do banco (plano.md, seção 3).
 *
 * Exceção à regra "tudo em src/server importa server-only": este arquivo é lido
 * pelo drizzle-kit fora do Next.js, então não pode importar `server-only`.
 * Ele só declara tabelas; não contém lógica nem segredos.
 *
 * Colunas com comentário 🔒 guardam texto cifrado (AES-256-GCM, formato
 * `v1:iv:tag:ciphertext`) produzido por `src/server/crypto`.
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { v7 as uuidv7 } from "uuid";

const id = () =>
  uuid("id")
    .primaryKey()
    .$defaultFn(() => uuidv7());
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdateFn(() => new Date());

// ---------------------------------------------------------------- enums
export const consentKind = pgEnum("consent_kind", [
  "terms",
  "privacy",
  "third_party_data",
  "adult",
  "ai_disclaimer",
  /** Consentimento específico e destacado para dados sensíveis (LGPD, art. 11, I). */
  "sensitive_data",
  /** Consentimento específico para a transferência internacional (LGPD, art. 33, VIII). */
  "international_transfer",
]);
export const sourceType = pgEnum("source_type", [
  "paste",
  "txt",
  "zip_images",
  "zip_whatsapp",
  "images",
]);
export const conversationStatus = pgEnum("conversation_status", [
  "uploaded",
  "processing",
  "needs_confirmation",
  "generating",
  "ready",
  "failed",
  "deleted",
]);
export const userSide = pgEnum("user_side", ["a", "b", "none"]);
export const messageSender = pgEnum("message_sender", ["a", "b", "other", "system"]);
export const messageKind = pgEnum("message_kind", [
  "text",
  "media_omitted",
  "deleted",
  "sticker",
  "audio",
  "system",
]);
export const messageSource = pgEnum("message_source", ["text", "ocr"]);
/**
 * `subscription` (assinatura mensal) e `overage` (relatório do assinante além do limite diário)
 * não são relatórios: usam o catálogo só para preço, Payment Links e conferência no webhook (D96).
 */
export const reportKind = pgEnum("report_kind", ["main", "extra", "subscription", "overage"]);
export const reportStatus = pgEnum("report_status", [
  "pending_payment",
  "queued",
  "generating",
  "ready",
  "failed",
]);
export const purchaseStatus = pgEnum("purchase_status", [
  "pending",
  "paid",
  "failed",
  "expired",
  "refunded",
  "disputed",
]);
export const rateLimitAction = pgEnum("rate_limit_action", [
  "upload",
  "login_email",
  "checkout",
  "reprocess",
  "export",
]);

// ---------------------------------------------------------------- users & auth
export const users = pgTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const sessions = pgTable(
  "sessions",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    /** true quando criada via link mágico (acesso a todas as análises do e-mail). */
    verified: boolean("verified").notNull().default(false),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    userAgentHash: text("user_agent_hash"),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const loginTokens = pgTable("login_tokens", {
  id: id(),
  email: text("email").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------- conversations
export const conversations = pgTable(
  "conversations",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Sessão (não verificada) que fez o envio; dá acesso só a esta análise. */
    createdBySessionId: uuid("created_by_session_id").references(() => sessions.id, {
      onDelete: "set null",
    }),
    sourceType: sourceType("source_type").notNull(),
    status: conversationStatus("status").notNull().default("uploaded"),
    /** { step, current, total } — nunca conteúdo. */
    progress: jsonb("progress").$type<{ step: string; current?: number; total?: number }>(),
    errorCode: text("error_code"),
    participantAName: text("participant_a_name"), // 🔒
    participantBName: text("participant_b_name"), // 🔒
    userIs: userSide("user_is").notNull().default("none"),
    /** 🔒 JSON: remetentes detectados [{ index, raw, count, samples[], side? }] */
    detectedSenders: text("detected_senders"),
    /** Códigos de aviso, sem conteúdo (ex.: "few_messages", "ocr_low_confidence"). */
    warnings: jsonb("warnings").$type<Record<string, number | boolean>>(),
    timezone: text("timezone").notNull().default("America/Sao_Paulo"),
    messageCount: integer("message_count").notNull().default(0),
    hasTimestamps: boolean("has_timestamps").notNull().default(false),
    startedAt: timestamp("started_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    stats: jsonb("stats"),
    filesPurgedAt: timestamp("files_purged_at", { withTimezone: true }),
    lastAccessedAt: timestamp("last_accessed_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    retentionWarnedAt: timestamp("retention_warned_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("conversations_user_idx").on(t.userId),
    index("conversations_expires_idx").on(t.expiresAt),
  ],
);

export const consents = pgTable(
  "consents",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id").references(() => conversations.id, {
      onDelete: "cascade",
    }),
    kind: consentKind("kind").notNull(),
    version: text("version").notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull().defaultNow(),
    ipHash: text("ip_hash"),
  },
  (t) => [index("consents_user_idx").on(t.userId)],
);

export const conversationFiles = pgTable(
  "conversation_files",
  {
    id: id(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    storageKey: text("storage_key").notNull(),
    originalName: text("original_name"), // 🔒
    mime: text("mime").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    sha256: text("sha256").notNull(),
    orderIndex: integer("order_index").notNull(),
    createdAt: createdAt(),
    purgedAt: timestamp("purged_at", { withTimezone: true }),
  },
  (t) => [index("conversation_files_conv_idx").on(t.conversationId)],
);

export const messages = pgTable(
  "messages",
  {
    id: id(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    sender: messageSender("sender").notNull().default("other"),
    /** Índice em detected_senders (não sensível); permite remapear sem decifrar. */
    senderIndex: smallint("sender_index"),
    senderRaw: text("sender_raw"), // 🔒
    sentAt: timestamp("sent_at", { withTimezone: true }),
    kind: messageKind("kind").notNull(),
    content: text("content").notNull(), // 🔒
    source: messageSource("source").notNull(),
    ocrConfidence: real("ocr_confidence"),
  },
  (t) => [uniqueIndex("messages_conv_seq_uq").on(t.conversationId, t.seq)],
);

/** Notas do map (map-reduce) cifradas, reaproveitadas pelos adicionais. */
export const conversationDigests = pgTable(
  "conversation_digests",
  {
    id: id(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    chunkIndex: integer("chunk_index").notNull(),
    level: integer("level").notNull().default(0),
    promptVersion: text("prompt_version").notNull(),
    fromSeq: integer("from_seq").notNull(),
    toSeq: integer("to_seq").notNull(),
    content: text("content").notNull(), // 🔒 JSON das notas
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("conversation_digests_uq").on(
      t.conversationId,
      t.level,
      t.chunkIndex,
      t.promptVersion,
    ),
  ],
);

// ---------------------------------------------------------------- reports
export const reportTypes = pgTable("report_types", {
  id: id(),
  slug: text("slug").notNull().unique(),
  kind: reportKind("kind").notNull(),
  name: text("name").notNull(),
  teaser: text("teaser").notNull(),
  description: text("description").notNull(),
  /** Preço COBRADO (bruto), calculado a partir do líquido + taxa do Stripe. */
  priceCents: integer("price_cents").notNull(),
  /** Valor LÍQUIDO que o dono quer receber depois da taxa do Stripe. */
  netPriceCents: integer("net_price_cents").notNull().default(0),
  currency: text("currency").notNull().default("brl"),
  promptTemplate: text("prompt_template").notNull(),
  outputSchemaVersion: integer("output_schema_version").notNull().default(1),
  stripePaymentLinkId: text("stripe_payment_link_id"),
  stripePaymentLinkUrl: text("stripe_payment_link_url"),
  stripeTestPaymentLinkId: text("stripe_test_payment_link_id"),
  stripeTestPaymentLinkUrl: text("stripe_test_payment_link_url"),
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  requiresUserSide: boolean("requires_user_side").notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const reports = pgTable(
  "reports",
  {
    id: id(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    reportTypeId: uuid("report_type_id")
      .notNull()
      .references(() => reportTypes.id),
    status: reportStatus("status").notNull(),
    /** { step, current, total } — nunca conteúdo. */
    progress: jsonb("progress").$type<{ step: string; current?: number; total?: number }>(),
    hookText: text("hook_text"), // 🔒
    verdict: text("verdict"), // 🔒 JSON { label, score, explanation }
    freeSectionCount: integer("free_section_count").notNull().default(0),
    safetyFlag: boolean("safety_flag").notNull().default(false),
    /** SÓ src/server/payments/fulfill.ts escreve esta coluna. */
    isUnlocked: boolean("is_unlocked").notNull().default(false),
    unlockedAt: timestamp("unlocked_at", { withTimezone: true }),
    modelUsed: text("model_used"),
    promptVersion: text("prompt_version"),
    tokensIn: integer("tokens_in").notNull().default(0),
    tokensOut: integer("tokens_out").notNull().default(0),
    errorCode: text("error_code"),
    readyEmailSentAt: timestamp("ready_email_sent_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("reports_conv_type_uq").on(t.conversationId, t.reportTypeId)],
);

export const reportSections = pgTable(
  "report_sections",
  {
    id: id(),
    reportId: uuid("report_id")
      .notNull()
      .references(() => reports.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    key: text("key").notNull(),
    title: text("title").notNull(), // 🔒 (pode conter spoiler)
    lockedTitle: text("locked_title").notNull(),
    content: text("content").notNull(), // 🔒
    isFree: boolean("is_free").notNull().default(false),
    isSafety: boolean("is_safety").notNull().default(false),
    evidence: text("evidence"), // 🔒 JSON [{ seq, quote }]
  },
  (t) => [uniqueIndex("report_sections_pos_uq").on(t.reportId, t.position)],
);

// ---------------------------------------------------------------- payments
export const purchases = pgTable(
  "purchases",
  {
    id: id(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    reportId: uuid("report_id").references(() => reports.id, { onDelete: "set null" }),
    reportTypeId: uuid("report_type_id")
      .notNull()
      .references(() => reportTypes.id),
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull(),
    livemode: boolean("livemode").notNull().default(false),
    status: purchaseStatus("status").notNull().default("pending"),
    stripeCheckoutSessionId: text("stripe_checkout_session_id").unique(),
    stripePaymentIntentId: text("stripe_payment_intent_id"),
    paymentMethodType: text("payment_method_type"),
    amountPaidCents: integer("amount_paid_cents"),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("purchases_one_paid_per_report_uq")
      .on(t.reportId)
      .where(sql`${t.status} = 'paid'`),
    index("purchases_report_idx").on(t.reportId),
    index("purchases_pi_idx").on(t.stripePaymentIntentId),
  ],
);

export const stripeEvents = pgTable("stripe_events", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  error: text("error"),
});

/**
 * Assinaturas mensais (D96). O estado vem SÓ do webhook do Stripe (assinatura conferida)
 * ou da reconciliação (API autenticada do Stripe); nada aqui é gravado a partir do navegador.
 */
export const subscriptions = pgTable(
  "subscriptions",
  {
    id: id(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    purchaseId: uuid("purchase_id").references(() => purchases.id, { onDelete: "set null" }),
    stripeSubscriptionId: text("stripe_subscription_id").notNull().unique(),
    stripeCustomerId: text("stripe_customer_id"),
    /** Status do Stripe: active, trialing, past_due, canceled, unpaid, incomplete... */
    status: text("status").notNull(),
    livemode: boolean("livemode").notNull().default(false),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
    /** Reembolso de uma cobrança da assinatura: o acesso termina na hora. */
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    /** `created` do último evento aplicado (eventos fora de ordem são ignorados). */
    lastEventAt: timestamp("last_event_at", { withTimezone: true }),
    syncedAt: timestamp("synced_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("subscriptions_user_idx").on(t.userId), index("subscriptions_customer_idx").on(t.stripeCustomerId)],
);

/**
 * Relatórios liberados pela assinatura. `counts` = conta no limite diário (relatório principal);
 * adicionais liberados pela assinatura ficam registrados com `counts = false`.
 * `day` é o dia no horário de Brasília em que o relatório foi liberado.
 */
export const subscriptionUnlocks = pgTable(
  "subscription_unlocks",
  {
    id: id(),
    subscriptionId: uuid("subscription_id")
      .notNull()
      .references(() => subscriptions.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Sem cascata: excluir a análise não devolve a cota do dia. */
    reportId: uuid("report_id").references(() => reports.id, { onDelete: "set null" }),
    counts: boolean("counts").notNull(),
    day: date("day").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("subscription_unlocks_report_uq").on(t.reportId),
    index("subscription_unlocks_user_day_idx").on(t.userId, t.day),
    index("subscription_unlocks_sub_idx").on(t.subscriptionId),
  ],
);

// ---------------------------------------------------------------- infra
export const rateLimits = pgTable(
  "rate_limits",
  {
    id: id(),
    keyHash: text("key_hash").notNull(),
    action: rateLimitAction("action").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("rate_limits_lookup_idx").on(t.action, t.keyHash, t.createdAt)],
);

/** Estado do limitador de tokens da Groq, por modelo (lido dos cabeçalhos x-ratelimit-*). */
export const aiRateState = pgTable("ai_rate_state", {
  model: text("model").primaryKey(),
  remainingTokens: integer("remaining_tokens"),
  remainingRequests: integer("remaining_requests"),
  resetTokensAt: timestamp("reset_tokens_at", { withTimezone: true }),
  resetRequestsAt: timestamp("reset_requests_at", { withTimezone: true }),
  blockedUntil: timestamp("blocked_until", { withTimezone: true }),
  updatedAt: updatedAt(),
});

export const auditLog = pgTable(
  "audit_log",
  {
    id: id(),
    userId: uuid("user_id"),
    action: text("action").notNull(),
    targetId: text("target_id"),
    meta: jsonb("meta").$type<Record<string, string | number | boolean | null>>(),
    createdAt: createdAt(),
  },
  (t) => [index("audit_log_action_idx").on(t.action, t.createdAt)],
);

/**
 * Registros de acesso a aplicações (Marco Civil da Internet, art. 15): IP, data e hora, guardados
 * com sigilo por 6 meses. Sem chave estrangeira de propósito: a obrigação legal vale mesmo depois de
 * a conta ser excluída (LGPD, art. 16, I). Só saem por ordem judicial ou para o próprio titular.
 */
export const accessLogs = pgTable(
  "access_logs",
  {
    id: id(),
    userId: uuid("user_id"),
    /** login | upload | checkout | data_export | account_deletion */
    event: text("event").notNull(),
    ip: text("ip").notNull(), // 🔒
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("access_logs_occurred_idx").on(t.occurredAt), index("access_logs_user_idx").on(t.userId)],
);

/** Eventos de funil sem dados pessoais (Fase 5). */
export const funnelEvents = pgTable(
  "funnel_events",
  {
    id: id(),
    event: text("event").notNull(),
    reportTypeSlug: text("report_type_slug"),
    sourceType: text("source_type"),
    createdAt: createdAt(),
  },
  (t) => [index("funnel_events_event_idx").on(t.event, t.createdAt)],
);

export type User = typeof users.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type Conversation = typeof conversations.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type ReportType = typeof reportTypes.$inferSelect;
export type Report = typeof reports.$inferSelect;
export type ReportSection = typeof reportSections.$inferSelect;
export type Purchase = typeof purchases.$inferSelect;
export type Subscription = typeof subscriptions.$inferSelect;
