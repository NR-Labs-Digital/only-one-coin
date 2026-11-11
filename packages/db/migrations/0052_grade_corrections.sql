CREATE TABLE "grade_corrections" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"grade_id" uuid NOT NULL,
	"replaces_id" uuid,
	"score" numeric(4, 2),
	"did_not_sit" boolean DEFAULT false NOT NULL,
	"reason" text NOT NULL,
	"corrected_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "grade_corrections_value_check" CHECK (("grade_corrections"."did_not_sit" and "grade_corrections"."score" is null) or (not "grade_corrections"."did_not_sit" and "grade_corrections"."score" between 0 and 20)),
	CONSTRAINT "grade_corrections_reason_check" CHECK (length(btrim("grade_corrections"."reason")) between 1 and 500)
);
--> statement-breakpoint
ALTER TABLE "grade_corrections" ADD CONSTRAINT "grade_corrections_grade_id_grades_id_fk" FOREIGN KEY ("grade_id") REFERENCES "public"."grades"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grade_corrections" ADD CONSTRAINT "grade_corrections_replaces_id_grade_corrections_id_fk" FOREIGN KEY ("replaces_id") REFERENCES "public"."grade_corrections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "grade_corrections_first_uidx" ON "grade_corrections" USING btree ("grade_id") WHERE "grade_corrections"."replaces_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "grade_corrections_replaces_uidx" ON "grade_corrections" USING btree ("replaces_id") WHERE "grade_corrections"."replaces_id" is not null;--> statement-breakpoint
-- Hand-written, as in 0051: Better Auth's "user" is not in the Drizzle schema.
-- Restrict: who corrected a grade outlives the account.
ALTER TABLE "grade_corrections" ADD CONSTRAINT "grade_corrections_corrected_by_user_id_fk" FOREIGN KEY ("corrected_by") REFERENCES "user"("id") ON DELETE restrict;
--> statement-breakpoint
-- A correction is history too (OOC-102): it is never edited nor removed — the
-- next correction replaces it. Both layers, never one (packages/db/CLAUDE.md).
REVOKE UPDATE, DELETE ON grade_corrections FROM ooc_app;
--> statement-breakpoint
DROP TRIGGER IF EXISTS grade_corrections_append_only ON grade_corrections;
--> statement-breakpoint
CREATE TRIGGER grade_corrections_append_only
	BEFORE UPDATE OR DELETE OR TRUNCATE ON grade_corrections
	FOR EACH STATEMENT EXECUTE FUNCTION forbid_history_rewrite();
--> statement-breakpoint
-- The grade that counts, per graded seat: the correction nobody replaced
-- (the line has one), else the posted grade. Every reader goes through it.
CREATE VIEW "current_grades" AS
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
	c.corrected_by
FROM grades g
LEFT JOIN LATERAL (
	SELECT gc.id, gc.score, gc.did_not_sit, gc.created_at, gc.corrected_by
	FROM grade_corrections gc
	WHERE gc.grade_id = g.id
		AND NOT EXISTS (SELECT 1 FROM grade_corrections n WHERE n.replaces_id = gc.id)
) c ON true;
--> statement-breakpoint
GRANT SELECT ON "current_grades" TO ooc_app;
