CREATE TABLE "outbox_delivery_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"outbox_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"reason" text,
	"dedupe_key" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outbox_delivery_events_kind_check" CHECK ("outbox_delivery_events"."kind" in ('delivered', 'soft_bounce', 'hard_bounce', 'blocked', 'unsubscribed')),
	CONSTRAINT "outbox_delivery_events_reason_check" CHECK ("outbox_delivery_events"."reason" is null or "outbox_delivery_events"."reason" in ('mailbox_full', 'address_unknown', 'domain_invalid', 'blocked_by_server', 'other'))
);
--> statement-breakpoint
ALTER TABLE "outbox" ADD COLUMN "delivery_status" text;--> statement-breakpoint
ALTER TABLE "outbox" ADD COLUMN "delivery_status_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "email_invalid_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "outbox_delivery_events" ADD CONSTRAINT "outbox_delivery_events_outbox_id_outbox_id_fk" FOREIGN KEY ("outbox_id") REFERENCES "public"."outbox"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "outbox_delivery_events_dedupe_key_uidx" ON "outbox_delivery_events" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "outbox_delivery_events_kind_occurred_at_idx" ON "outbox_delivery_events" USING btree ("kind","occurred_at");--> statement-breakpoint
CREATE INDEX "outbox_delivery_events_outbox_id_idx" ON "outbox_delivery_events" USING btree ("outbox_id");--> statement-breakpoint
CREATE INDEX "outbox_provider_message_id_idx" ON "outbox" USING btree (trim(both '<>' from "provider_message_id")) WHERE "outbox"."provider_message_id" is not null;--> statement-breakpoint
ALTER TABLE "outbox" ADD CONSTRAINT "outbox_delivery_status_check" CHECK ("outbox"."delivery_status" is null or "outbox"."delivery_status" in ('delivered', 'soft_bounced', 'hard_bounced', 'blocked', 'unsubscribed'));--> statement-breakpoint
-- outbox_delivery_events is append-only (OOC-91): it is the provider's account
-- of what happened to a message, and a soft bounce followed by a delivery has
-- to stay a story. Both layers, never one of the two (packages/db/CLAUDE.md).
REVOKE UPDATE, DELETE ON outbox_delivery_events FROM ooc_app;
--> statement-breakpoint
DROP TRIGGER IF EXISTS outbox_delivery_events_append_only ON outbox_delivery_events;
--> statement-breakpoint
CREATE TRIGGER outbox_delivery_events_append_only
	BEFORE UPDATE OR DELETE OR TRUNCATE ON outbox_delivery_events
	FOR EACH STATEMENT EXECUTE FUNCTION forbid_history_rewrite();
--> statement-breakpoint
-- The webhook looks the row up by the expression index above, and the column
-- it reads has no statistics until somebody analyzes it (packages/db/CLAUDE.md).
ANALYZE outbox;
