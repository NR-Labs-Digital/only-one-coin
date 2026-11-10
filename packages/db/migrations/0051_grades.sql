CREATE TABLE "grades" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"enrollment_id" uuid NOT NULL,
	"class_group_id" uuid NOT NULL,
	"score" numeric(4, 2),
	"did_not_sit" boolean DEFAULT false NOT NULL,
	"recorded_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "grades_value_check" CHECK (("grades"."did_not_sit" and "grades"."score" is null) or (not "grades"."did_not_sit" and "grades"."score" between 0 and 20))
);
--> statement-breakpoint
ALTER TABLE "grades" ADD CONSTRAINT "grades_enrollment_id_enrollments_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "public"."enrollments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grades" ADD CONSTRAINT "grades_class_group_id_class_groups_id_fk" FOREIGN KEY ("class_group_id") REFERENCES "public"."class_groups"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "grades_class_group_enrollment_uidx" ON "grades" USING btree ("class_group_id","enrollment_id");--> statement-breakpoint
-- Hand-written, as in 0046: Better Auth's "user" is not in the Drizzle schema.
-- Restrict: who posted a grade outlives the account.
ALTER TABLE "grades" ADD CONSTRAINT "grades_recorded_by_user_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "user"("id") ON DELETE restrict;
--> statement-breakpoint
-- A posted grade is final (CLAUDE.md §1, 08/10/2026): grades joins the
-- append-only lock. Both layers, never one of the two (packages/db/CLAUDE.md).
REVOKE UPDATE, DELETE ON grades FROM ooc_app;
--> statement-breakpoint
DROP TRIGGER IF EXISTS grades_append_only ON grades;
--> statement-breakpoint
CREATE TRIGGER grades_append_only
	BEFORE UPDATE OR DELETE OR TRUNCATE ON grades
	FOR EACH STATEMENT EXECUTE FUNCTION forbid_history_rewrite();
