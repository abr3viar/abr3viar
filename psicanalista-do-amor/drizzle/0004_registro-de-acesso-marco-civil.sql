CREATE TABLE "access_logs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"event" text NOT NULL,
	"ip" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "access_logs_occurred_idx" ON "access_logs" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "access_logs_user_idx" ON "access_logs" USING btree ("user_id");