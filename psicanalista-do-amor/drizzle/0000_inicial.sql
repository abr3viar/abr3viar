CREATE TYPE "public"."consent_kind" AS ENUM('terms', 'privacy', 'third_party_data', 'adult', 'ai_disclaimer');--> statement-breakpoint
CREATE TYPE "public"."conversation_status" AS ENUM('uploaded', 'processing', 'needs_confirmation', 'generating', 'ready', 'failed', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."message_kind" AS ENUM('text', 'media_omitted', 'deleted', 'sticker', 'audio', 'system');--> statement-breakpoint
CREATE TYPE "public"."message_sender" AS ENUM('a', 'b', 'other', 'system');--> statement-breakpoint
CREATE TYPE "public"."message_source" AS ENUM('text', 'ocr');--> statement-breakpoint
CREATE TYPE "public"."purchase_status" AS ENUM('pending', 'paid', 'failed', 'expired', 'refunded', 'disputed');--> statement-breakpoint
CREATE TYPE "public"."rate_limit_action" AS ENUM('upload', 'login_email', 'checkout', 'reprocess', 'export');--> statement-breakpoint
CREATE TYPE "public"."report_kind" AS ENUM('main', 'extra');--> statement-breakpoint
CREATE TYPE "public"."report_status" AS ENUM('pending_payment', 'queued', 'generating', 'ready', 'failed');--> statement-breakpoint
CREATE TYPE "public"."source_type" AS ENUM('paste', 'txt', 'zip_images', 'zip_whatsapp', 'images');--> statement-breakpoint
CREATE TYPE "public"."user_side" AS ENUM('a', 'b', 'none');--> statement-breakpoint
CREATE TABLE "ai_rate_state" (
	"model" text PRIMARY KEY NOT NULL,
	"remaining_tokens" integer,
	"remaining_requests" integer,
	"reset_tokens_at" timestamp with time zone,
	"reset_requests_at" timestamp with time zone,
	"blocked_until" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"action" text NOT NULL,
	"target_id" text,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"conversation_id" uuid,
	"kind" "consent_kind" NOT NULL,
	"version" text NOT NULL,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_hash" text
);
--> statement-breakpoint
CREATE TABLE "conversation_digests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"conversation_id" uuid NOT NULL,
	"chunk_index" integer NOT NULL,
	"level" integer DEFAULT 0 NOT NULL,
	"prompt_version" text NOT NULL,
	"from_seq" integer NOT NULL,
	"to_seq" integer NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation_files" (
	"id" uuid PRIMARY KEY NOT NULL,
	"conversation_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"original_name" text,
	"mime" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"order_index" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"purged_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"created_by_session_id" uuid,
	"source_type" "source_type" NOT NULL,
	"status" "conversation_status" DEFAULT 'uploaded' NOT NULL,
	"progress" jsonb,
	"error_code" text,
	"participant_a_name" text,
	"participant_b_name" text,
	"user_is" "user_side" DEFAULT 'none' NOT NULL,
	"detected_senders" text,
	"warnings" jsonb,
	"timezone" text DEFAULT 'America/Sao_Paulo' NOT NULL,
	"message_count" integer DEFAULT 0 NOT NULL,
	"has_timestamps" boolean DEFAULT false NOT NULL,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"stats" jsonb,
	"files_purged_at" timestamp with time zone,
	"last_accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"retention_warned_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "funnel_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"event" text NOT NULL,
	"report_type_slug" text,
	"source_type" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "login_tokens" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "login_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"conversation_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"sender" "message_sender" DEFAULT 'other' NOT NULL,
	"sender_index" smallint,
	"sender_raw" text,
	"sent_at" timestamp with time zone,
	"kind" "message_kind" NOT NULL,
	"content" text NOT NULL,
	"source" "message_source" NOT NULL,
	"ocr_confidence" real
);
--> statement-breakpoint
CREATE TABLE "purchases" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"report_id" uuid,
	"report_type_id" uuid NOT NULL,
	"amount_cents" integer NOT NULL,
	"currency" text NOT NULL,
	"livemode" boolean DEFAULT false NOT NULL,
	"status" "purchase_status" DEFAULT 'pending' NOT NULL,
	"stripe_checkout_session_id" text,
	"stripe_payment_intent_id" text,
	"payment_method_type" text,
	"amount_paid_cents" integer,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchases_stripe_checkout_session_id_unique" UNIQUE("stripe_checkout_session_id")
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"id" uuid PRIMARY KEY NOT NULL,
	"key_hash" text NOT NULL,
	"action" "rate_limit_action" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_sections" (
	"id" uuid PRIMARY KEY NOT NULL,
	"report_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"key" text NOT NULL,
	"title" text NOT NULL,
	"locked_title" text NOT NULL,
	"content" text NOT NULL,
	"is_free" boolean DEFAULT false NOT NULL,
	"is_safety" boolean DEFAULT false NOT NULL,
	"evidence" text
);
--> statement-breakpoint
CREATE TABLE "report_types" (
	"id" uuid PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"kind" "report_kind" NOT NULL,
	"name" text NOT NULL,
	"teaser" text NOT NULL,
	"description" text NOT NULL,
	"price_cents" integer NOT NULL,
	"currency" text DEFAULT 'brl' NOT NULL,
	"prompt_template" text NOT NULL,
	"output_schema_version" integer DEFAULT 1 NOT NULL,
	"stripe_payment_link_id" text,
	"stripe_payment_link_url" text,
	"stripe_test_payment_link_id" text,
	"stripe_test_payment_link_url" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"requires_user_side" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "report_types_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"conversation_id" uuid NOT NULL,
	"report_type_id" uuid NOT NULL,
	"status" "report_status" NOT NULL,
	"progress" jsonb,
	"hook_text" text,
	"verdict" text,
	"free_section_count" integer DEFAULT 0 NOT NULL,
	"safety_flag" boolean DEFAULT false NOT NULL,
	"is_unlocked" boolean DEFAULT false NOT NULL,
	"unlocked_at" timestamp with time zone,
	"model_used" text,
	"prompt_version" text,
	"tokens_in" integer DEFAULT 0 NOT NULL,
	"tokens_out" integer DEFAULT 0 NOT NULL,
	"error_code" text,
	"ready_email_sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_agent_hash" text,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "stripe_events" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"email_verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_digests" ADD CONSTRAINT "conversation_digests_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_files" ADD CONSTRAINT "conversation_files_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_created_by_session_id_sessions_id_fk" FOREIGN KEY ("created_by_session_id") REFERENCES "public"."sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_report_type_id_report_types_id_fk" FOREIGN KEY ("report_type_id") REFERENCES "public"."report_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_sections" ADD CONSTRAINT "report_sections_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_report_type_id_report_types_id_fk" FOREIGN KEY ("report_type_id") REFERENCES "public"."report_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_action_idx" ON "audit_log" USING btree ("action","created_at");--> statement-breakpoint
CREATE INDEX "consents_user_idx" ON "consents" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_digests_uq" ON "conversation_digests" USING btree ("conversation_id","level","chunk_index","prompt_version");--> statement-breakpoint
CREATE INDEX "conversation_files_conv_idx" ON "conversation_files" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "conversations_user_idx" ON "conversations" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "conversations_expires_idx" ON "conversations" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "funnel_events_event_idx" ON "funnel_events" USING btree ("event","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "messages_conv_seq_uq" ON "messages" USING btree ("conversation_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "purchases_one_paid_per_report_uq" ON "purchases" USING btree ("report_id") WHERE "purchases"."status" = 'paid';--> statement-breakpoint
CREATE INDEX "purchases_report_idx" ON "purchases" USING btree ("report_id");--> statement-breakpoint
CREATE INDEX "purchases_pi_idx" ON "purchases" USING btree ("stripe_payment_intent_id");--> statement-breakpoint
CREATE INDEX "rate_limits_lookup_idx" ON "rate_limits" USING btree ("action","key_hash","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "report_sections_pos_uq" ON "report_sections" USING btree ("report_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "reports_conv_type_uq" ON "reports" USING btree ("conversation_id","report_type_id");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");