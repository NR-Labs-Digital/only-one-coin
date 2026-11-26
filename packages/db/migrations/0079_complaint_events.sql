CREATE TABLE "complaint_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"complaint_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"answer" text,
	"actor_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "complaint_events_kind_check" CHECK ("complaint_events"."kind" in ('taken', 'answered')),
	CONSTRAINT "complaint_events_answer_check" CHECK (("complaint_events"."kind" = 'answered' and length(btrim("complaint_events"."answer")) between 1 and 5000) or ("complaint_events"."kind" <> 'answered' and "complaint_events"."answer" is null))
);
--> statement-breakpoint
ALTER TABLE "platform_settings" ADD COLUMN "complaint_response_business_days" integer DEFAULT 15 NOT NULL;--> statement-breakpoint
ALTER TABLE "complaint_events" ADD CONSTRAINT "complaint_events_complaint_id_complaints_id_fk" FOREIGN KEY ("complaint_id") REFERENCES "public"."complaints"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "complaint_events_complaint_kind_uidx" ON "complaint_events" USING btree ("complaint_id","kind");--> statement-breakpoint
ALTER TABLE "platform_settings" ADD CONSTRAINT "platform_settings_complaint_response_business_days_check" CHECK ("platform_settings"."complaint_response_business_days" between 1 and 60);--> statement-breakpoint
-- Better Auth's "user" lives outside schema.ts: the FK is written by hand, as
-- in 0074. Every step of a sheet is a person's.
ALTER TABLE "complaint_events" ADD CONSTRAINT "complaint_events_actor_id_user_fk" FOREIGN KEY ("actor_id") REFERENCES "user"("id") ON DELETE restrict;
--> statement-breakpoint
-- What the company did with a sheet of the complaints book (OOC-58) is part
-- of the legal record, like the sheet itself: never rewritten, never
-- removed. Both layers, never one (packages/db/CLAUDE.md).
REVOKE UPDATE, DELETE ON complaint_events FROM ooc_app;
--> statement-breakpoint
DROP TRIGGER IF EXISTS complaint_events_append_only ON complaint_events;
--> statement-breakpoint
CREATE TRIGGER complaint_events_append_only
	BEFORE UPDATE OR DELETE OR TRUNCATE ON complaint_events
	FOR EACH STATEMENT EXECUTE FUNCTION forbid_history_rewrite();
