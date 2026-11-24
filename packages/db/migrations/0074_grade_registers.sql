CREATE TABLE "grade_register_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"register_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"note" text,
	"module_ends_on" date,
	"actor_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "grade_register_events_kind_check" CHECK ("grade_register_events"."kind" in ('submitted', 'returned', 'confirmed')),
	CONSTRAINT "grade_register_events_note_check" CHECK (("grade_register_events"."kind" = 'returned' and length(btrim("grade_register_events"."note")) between 1 and 1000) or ("grade_register_events"."kind" <> 'returned' and "grade_register_events"."note" is null))
);
--> statement-breakpoint
CREATE TABLE "grade_registers" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"class_group_id" uuid NOT NULL,
	"class_group_module_id" uuid NOT NULL,
	"round" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "grade_registers_round_check" CHECK ("grade_registers"."round" > 0),
	CONSTRAINT "grade_registers_status_check" CHECK ("grade_registers"."status" in ('draft', 'in_review', 'returned', 'official'))
);
--> statement-breakpoint
ALTER TABLE "grade_corrections" DROP CONSTRAINT "grade_corrections_reason_check";--> statement-breakpoint
ALTER TABLE "grade_corrections" ALTER COLUMN "reason" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "class_group_modules" ADD COLUMN "module_ends_on" date;--> statement-breakpoint
ALTER TABLE "grade_corrections" ADD COLUMN "kind" text DEFAULT 'correction' NOT NULL;--> statement-breakpoint
ALTER TABLE "grades" ADD COLUMN "register_id" uuid;--> statement-breakpoint
ALTER TABLE "platform_settings" ADD COLUMN "grade_submission_hours" integer DEFAULT 48 NOT NULL;--> statement-breakpoint
ALTER TABLE "grade_register_events" ADD CONSTRAINT "grade_register_events_register_id_grade_registers_id_fk" FOREIGN KEY ("register_id") REFERENCES "public"."grade_registers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grade_registers" ADD CONSTRAINT "grade_registers_class_group_id_class_groups_id_fk" FOREIGN KEY ("class_group_id") REFERENCES "public"."class_groups"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grade_registers" ADD CONSTRAINT "grade_registers_class_group_module_fk" FOREIGN KEY ("class_group_module_id","class_group_id") REFERENCES "public"."class_group_modules"("id","class_group_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "grade_register_events_register_id_idx" ON "grade_register_events" USING btree ("register_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "grade_registers_run_round_uidx" ON "grade_registers" USING btree ("class_group_module_id","round");--> statement-breakpoint
CREATE UNIQUE INDEX "grade_registers_run_open_uidx" ON "grade_registers" USING btree ("class_group_module_id") WHERE "grade_registers"."status" <> 'official';--> statement-breakpoint
CREATE INDEX "grade_registers_class_group_id_idx" ON "grade_registers" USING btree ("class_group_id");--> statement-breakpoint
ALTER TABLE "grades" ADD CONSTRAINT "grades_register_id_grade_registers_id_fk" FOREIGN KEY ("register_id") REFERENCES "public"."grade_registers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grade_corrections" ADD CONSTRAINT "grade_corrections_kind_check" CHECK ("grade_corrections"."kind" in ('correction', 'teacher_edit'));--> statement-breakpoint
ALTER TABLE "grade_corrections" ADD CONSTRAINT "grade_corrections_reason_check" CHECK (("grade_corrections"."kind" = 'teacher_edit' and "grade_corrections"."reason" is null) or ("grade_corrections"."kind" = 'correction' and length(btrim("grade_corrections"."reason")) between 1 and 500));--> statement-breakpoint
ALTER TABLE "platform_settings" ADD CONSTRAINT "platform_settings_grade_submission_hours_check" CHECK ("platform_settings"."grade_submission_hours" between 1 and 720);--> statement-breakpoint
-- Better Auth's "user" lives outside schema.ts: the FK is written by hand, as
-- in 0071. Every step of a register is a person.
ALTER TABLE "grade_register_events" ADD CONSTRAINT "grade_register_events_actor_id_user_fk" FOREIGN KEY ("actor_id") REFERENCES "user"("id") ON DELETE restrict;
--> statement-breakpoint
-- A register's steps are history (OOC-180): who sent, returned and confirmed
-- it, and when. Never rewritten nor removed — both layers, never one
-- (packages/db/CLAUDE.md).
REVOKE UPDATE, DELETE ON grade_register_events FROM ooc_app;
--> statement-breakpoint
DROP TRIGGER IF EXISTS grade_register_events_append_only ON grade_register_events;
--> statement-breakpoint
CREATE TRIGGER grade_register_events_append_only
	BEFORE UPDATE OR DELETE OR TRUNCATE ON grade_register_events
	FOR EACH STATEMENT EXECUTE FUNCTION forbid_history_rewrite();
--> statement-breakpoint
-- register_id enters WHERE (which register a grade belongs to, whether it is
-- official); kind is read by every history.
ANALYZE grades;
--> statement-breakpoint
ANALYZE grade_corrections;
--> statement-breakpoint
-- The view gains the register and whether the grade is official (OOC-180),
-- at the end: CREATE OR REPLACE keeps the columns 0059 defined, in order. A
-- grade with no register predates registers and reads as official — final as
-- posted, the rule of its day.
CREATE OR REPLACE VIEW "current_grades" AS
SELECT
	g.id AS grade_id,
	g.enrollment_id,
	g.class_group_id,
	CASE WHEN c.id IS NULL THEN g.score ELSE c.score END AS score,
	CASE WHEN c.id IS NULL THEN g.did_not_sit ELSE c.did_not_sit END AS did_not_sit,
	g.created_at AS recorded_at,
	g.recorded_by,
	c.id AS correction_id,
	c.created_at AS corrected_at,
	c.corrected_by,
	coalesce(g.class_group_module_id, g.class_group_id) AS class_group_module_id,
	g.attempt,
	g.register_id,
	r.status AS register_status,
	(r.id IS NULL OR r.status = 'official') AS official
FROM grades g
LEFT JOIN grade_registers r ON r.id = g.register_id
LEFT JOIN LATERAL (
	SELECT gc.id, gc.score, gc.did_not_sit, gc.created_at, gc.corrected_by
	FROM grade_corrections gc
	WHERE gc.grade_id = g.id
		AND NOT EXISTS (SELECT 1 FROM grade_corrections n WHERE n.replaces_id = gc.id)
) c ON true;
