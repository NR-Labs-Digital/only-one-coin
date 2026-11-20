CREATE TABLE "enrollment_freeze_returns" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"freeze_id" uuid NOT NULL,
	"class_group_id" uuid NOT NULL,
	"class_group_module_id" uuid NOT NULL,
	"returned_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "enrollment_freezes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"enrollment_id" uuid NOT NULL,
	"class_group_id" uuid NOT NULL,
	"class_group_module_id" uuid NOT NULL,
	"module" integer,
	"attempt" integer NOT NULL,
	"frozen_by" text NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "enrollment_freezes_attempt_check" CHECK ("enrollment_freezes"."attempt" > 0)
);
--> statement-breakpoint
ALTER TABLE "enrollments" DROP CONSTRAINT "enrollments_seat_status_check";--> statement-breakpoint
ALTER TABLE "enrollment_freeze_returns" ADD CONSTRAINT "enrollment_freeze_returns_freeze_id_enrollment_freezes_id_fk" FOREIGN KEY ("freeze_id") REFERENCES "public"."enrollment_freezes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollment_freeze_returns" ADD CONSTRAINT "enrollment_freeze_returns_class_group_id_class_groups_id_fk" FOREIGN KEY ("class_group_id") REFERENCES "public"."class_groups"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollment_freeze_returns" ADD CONSTRAINT "enrollment_freeze_returns_module_fk" FOREIGN KEY ("class_group_module_id") REFERENCES "public"."class_group_modules"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollment_freezes" ADD CONSTRAINT "enrollment_freezes_enrollment_id_enrollments_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "public"."enrollments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollment_freezes" ADD CONSTRAINT "enrollment_freezes_class_group_id_class_groups_id_fk" FOREIGN KEY ("class_group_id") REFERENCES "public"."class_groups"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollment_freezes" ADD CONSTRAINT "enrollment_freezes_module_fk" FOREIGN KEY ("class_group_module_id") REFERENCES "public"."class_group_modules"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "enrollment_freeze_returns_freeze_id_uidx" ON "enrollment_freeze_returns" USING btree ("freeze_id");--> statement-breakpoint
CREATE INDEX "enrollment_freezes_enrollment_id_idx" ON "enrollment_freezes" USING btree ("enrollment_id","created_at");--> statement-breakpoint
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_seat_status_check" CHECK ("seat_status" in ('reserved', 'confirmed', 'released', 'frozen'));--> statement-breakpoint
ALTER TABLE "enrollment_freezes" ADD CONSTRAINT "enrollment_freezes_frozen_by_user_fk" FOREIGN KEY ("frozen_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "enrollment_freeze_returns" ADD CONSTRAINT "enrollment_freeze_returns_returned_by_user_fk" FOREIGN KEY ("returned_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
-- A freeze and its return are history (OOC-84): never edited nor removed.
-- Both layers, never one (packages/db/CLAUDE.md).
REVOKE UPDATE, DELETE ON enrollment_freezes FROM ooc_app;
--> statement-breakpoint
REVOKE UPDATE, DELETE ON enrollment_freeze_returns FROM ooc_app;
--> statement-breakpoint
DROP TRIGGER IF EXISTS enrollment_freezes_append_only ON enrollment_freezes;
--> statement-breakpoint
CREATE TRIGGER enrollment_freezes_append_only
	BEFORE UPDATE OR DELETE OR TRUNCATE ON enrollment_freezes
	FOR EACH STATEMENT EXECUTE FUNCTION forbid_history_rewrite();
--> statement-breakpoint
DROP TRIGGER IF EXISTS enrollment_freeze_returns_append_only ON enrollment_freeze_returns;
--> statement-breakpoint
CREATE TRIGGER enrollment_freeze_returns_append_only
	BEFORE UPDATE OR DELETE OR TRUNCATE ON enrollment_freeze_returns
	FOR EACH STATEMENT EXECUTE FUNCTION forbid_history_rewrite();
