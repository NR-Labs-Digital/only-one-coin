DROP INDEX "grades_class_group_enrollment_uidx";--> statement-breakpoint
ALTER TABLE "enrollments" ADD COLUMN "module_attempt" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "grades" ADD COLUMN "class_group_module_id" uuid;--> statement-breakpoint
ALTER TABLE "grades" ADD COLUMN "attempt" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "platform_settings" ADD COLUMN "progression_requires_passing_grade" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "grades" ADD CONSTRAINT "grades_class_group_module_fk" FOREIGN KEY ("class_group_module_id","class_group_id") REFERENCES "public"."class_group_modules"("id","class_group_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_module_attempt_check" CHECK ("enrollments"."module_attempt" > 0);--> statement-breakpoint
ALTER TABLE "grades" ADD CONSTRAINT "grades_attempt_check" CHECK ("grades"."attempt" > 0);--> statement-breakpoint
-- One grade per seat, module run and attempt (OOC-156). The run of a grade
-- posted before this migration is the one 0058 made under the class group's
-- id — the same coalesce every reader uses. Replaces the one-grade-per-class-
-- group index dropped above, which a second module, or a repeated one, in the
-- same class group would trip.
CREATE UNIQUE INDEX "grades_module_enrollment_attempt_uidx" ON "grades" USING btree (
	(coalesce("class_group_module_id", "class_group_id")), "enrollment_id", "attempt"
);--> statement-breakpoint
-- The view gains the run (resolved) and the attempt, at the end: CREATE OR
-- REPLACE keeps the columns 0052 defined, in their order.
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
	g.attempt
FROM grades g
LEFT JOIN LATERAL (
	SELECT gc.id, gc.score, gc.did_not_sit, gc.created_at, gc.corrected_by
	FROM grade_corrections gc
	WHERE gc.grade_id = g.id
		AND NOT EXISTS (SELECT 1 FROM grade_corrections n WHERE n.replaces_id = gc.id)
) c ON true;--> statement-breakpoint
-- A full course is one run per module (OOC-156, decision of 14/11/2026), same
-- teacher and week in each, so it grades and advances module by module like
-- every class group. Each live full-course run becomes module 1 — its
-- students stay in it, its grades (the course grade, before this) are
-- module 1's — and runs 2..N open beside it with the module's own Classroom.
INSERT INTO "class_group_modules" (
	"class_group_id", "module", "full_course", "teacher_id", "teacher_name", "slots", "classroom_links"
)
SELECT
	m."class_group_id", n.module, false, m."teacher_id", m."teacher_name", m."slots",
	CASE WHEN m."classroom_links" ? n.module::text
		THEN jsonb_build_object(n.module::text, m."classroom_links" ->> n.module::text)
		ELSE '{}'::jsonb END
FROM "class_group_modules" m
JOIN "class_groups" g ON g."id" = m."class_group_id"
JOIN "courses" c ON c."id" = g."course_id"
CROSS JOIN LATERAL generate_series(2, greatest(c."modules", 1)) AS n(module)
WHERE m."full_course" AND m."deleted_at" IS NULL;--> statement-breakpoint
UPDATE "class_group_modules"
SET "full_course" = false,
	"module" = 1,
	"classroom_links" = CASE WHEN "classroom_links" ? '1'
		THEN jsonb_build_object('1', "classroom_links" ->> '1')
		ELSE '{}'::jsonb END,
	"updated_at" = now()
WHERE "full_course" AND "deleted_at" IS NULL;--> statement-breakpoint
ANALYZE "grades";--> statement-breakpoint
ANALYZE "enrollments";
