ALTER TYPE "public"."report_kind" ADD VALUE 'subscription';--> statement-breakpoint
ALTER TYPE "public"."report_kind" ADD VALUE 'overage';--> statement-breakpoint
CREATE TABLE "subscription_unlocks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"subscription_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"report_id" uuid,
	"counts" boolean NOT NULL,
	"day" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"purchase_id" uuid,
	"stripe_subscription_id" text NOT NULL,
	"stripe_customer_id" text,
	"status" text NOT NULL,
	"livemode" boolean DEFAULT false NOT NULL,
	"current_period_end" timestamp with time zone,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"revoked_at" timestamp with time zone,
	"last_event_at" timestamp with time zone,
	"synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscriptions_stripe_subscription_id_unique" UNIQUE("stripe_subscription_id")
);
--> statement-breakpoint
ALTER TABLE "subscription_unlocks" ADD CONSTRAINT "subscription_unlocks_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_unlocks" ADD CONSTRAINT "subscription_unlocks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_unlocks" ADD CONSTRAINT "subscription_unlocks_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_purchase_id_purchases_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "public"."purchases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "subscription_unlocks_report_uq" ON "subscription_unlocks" USING btree ("report_id");--> statement-breakpoint
CREATE INDEX "subscription_unlocks_user_day_idx" ON "subscription_unlocks" USING btree ("user_id","day");--> statement-breakpoint
CREATE INDEX "subscription_unlocks_sub_idx" ON "subscription_unlocks" USING btree ("subscription_id");--> statement-breakpoint
CREATE INDEX "subscriptions_user_idx" ON "subscriptions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "subscriptions_customer_idx" ON "subscriptions" USING btree ("stripe_customer_id");