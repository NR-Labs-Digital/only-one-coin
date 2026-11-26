CREATE TABLE "grade_register_records" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"register_id" uuid NOT NULL,
	"teacher_id" uuid NOT NULL,
	"template_version_id" uuid NOT NULL,
	"data" jsonb NOT NULL,
	"recorded_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "grade_register_records" ADD CONSTRAINT "grade_register_records_register_id_grade_registers_id_fk" FOREIGN KEY ("register_id") REFERENCES "public"."grade_registers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grade_register_records" ADD CONSTRAINT "grade_register_records_teacher_id_teachers_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."teachers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grade_register_records" ADD CONSTRAINT "grade_register_records_template_version_fk" FOREIGN KEY ("template_version_id") REFERENCES "public"."document_template_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "grade_register_records_register_uidx" ON "grade_register_records" USING btree ("register_id");--> statement-breakpoint
-- Better Auth's "user" lives outside schema.ts: the FK is written by hand, as
-- in 0074. The first download is always a person's — staff or the teacher.
ALTER TABLE "grade_register_records" ADD CONSTRAINT "grade_register_records_recorded_by_user_fk" FOREIGN KEY ("recorded_by") REFERENCES "user"("id") ON DELETE restrict;
--> statement-breakpoint
-- An acta is what a teacher is paid against (OOC-176): its frozen data and
-- template version never change once recorded. Both layers, never one
-- (packages/db/CLAUDE.md).
REVOKE UPDATE, DELETE ON grade_register_records FROM ooc_app;
--> statement-breakpoint
DROP TRIGGER IF EXISTS grade_register_records_append_only ON grade_register_records;
--> statement-breakpoint
CREATE TRIGGER grade_register_records_append_only
	BEFORE UPDATE OR DELETE OR TRUNCATE ON grade_register_records
	FOR EACH STATEMENT EXECUTE FUNCTION forbid_history_rewrite();
