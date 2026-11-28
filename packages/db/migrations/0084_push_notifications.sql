CREATE TABLE "push_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" text NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "outbox" ADD COLUMN "push_status" text;--> statement-breakpoint
CREATE UNIQUE INDEX "push_subscriptions_endpoint_uidx" ON "push_subscriptions" USING btree ("endpoint");--> statement-breakpoint
CREATE INDEX "push_subscriptions_user_id_idx" ON "push_subscriptions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "outbox_push_pending_created_at_idx" ON "outbox" USING btree ("created_at") WHERE "outbox"."push_status" = 'pending';--> statement-breakpoint
ALTER TABLE "outbox" ADD CONSTRAINT "outbox_push_status_check" CHECK ("outbox"."push_status" is null or "outbox"."push_status" in ('pending', 'sending', 'sent', 'no_device', 'blocked', 'failed'));--> statement-breakpoint
-- Better Auth's "user" is not modelled in the schema, so the FK is written by hand (as in 0022, 0046).
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
-- push_status enters the push relay's WHERE (packages/db/CLAUDE.md: a new column in a WHERE is analyzed with it).
ANALYZE "outbox";
