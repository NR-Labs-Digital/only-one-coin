CREATE TABLE "issued_documents" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"kind" text NOT NULL,
	"code" text NOT NULL,
	"student_id" uuid NOT NULL,
	"enrollment_id" uuid NOT NULL,
	"procedure_request_id" uuid,
	"class_group_module_id" uuid,
	"template_version_id" uuid NOT NULL,
	"data" jsonb NOT NULL,
	"issued_by" text,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "issued_documents_kind_check" CHECK ("issued_documents"."kind" in ('enrollment_certificate', 'certificate')),
	CONSTRAINT "issued_documents_source_check" CHECK (("issued_documents"."kind" = 'enrollment_certificate') = ("issued_documents"."procedure_request_id" is not null)
        and ("issued_documents"."kind" = 'certificate') = ("issued_documents"."class_group_module_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "issued_documents" ADD CONSTRAINT "issued_documents_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issued_documents" ADD CONSTRAINT "issued_documents_enrollment_id_enrollments_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "public"."enrollments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issued_documents" ADD CONSTRAINT "issued_documents_procedure_request_id_procedure_requests_id_fk" FOREIGN KEY ("procedure_request_id") REFERENCES "public"."procedure_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issued_documents" ADD CONSTRAINT "issued_documents_class_group_module_fk" FOREIGN KEY ("class_group_module_id") REFERENCES "public"."class_group_modules"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issued_documents" ADD CONSTRAINT "issued_documents_template_version_fk" FOREIGN KEY ("template_version_id") REFERENCES "public"."document_template_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "issued_documents_code_uidx" ON "issued_documents" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "issued_documents_procedure_request_uidx" ON "issued_documents" USING btree ("procedure_request_id") WHERE "issued_documents"."procedure_request_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "issued_documents_certificate_enrollment_uidx" ON "issued_documents" USING btree ("enrollment_id") WHERE "issued_documents"."kind" = 'certificate';--> statement-breakpoint
CREATE INDEX "issued_documents_student_id_idx" ON "issued_documents" USING btree ("student_id");--> statement-breakpoint
-- Better Auth's "user" lives outside schema.ts: the FK is written by hand, as
-- in 0051. Null = the platform issued it on its own (a paid constancia).
ALTER TABLE "issued_documents" ADD CONSTRAINT "issued_documents_issued_by_user_fk" FOREIGN KEY ("issued_by") REFERENCES "user"("id") ON DELETE restrict;
--> statement-breakpoint
-- An issued document is history (OOC-33): never rewritten nor removed, so the
-- verification code always answers for the text that was handed out. Both
-- layers, never one (packages/db/CLAUDE.md).
REVOKE UPDATE, DELETE ON issued_documents FROM ooc_app;
--> statement-breakpoint
DROP TRIGGER IF EXISTS issued_documents_append_only ON issued_documents;
--> statement-breakpoint
CREATE TRIGGER issued_documents_append_only
	BEFORE UPDATE OR DELETE OR TRUNCATE ON issued_documents
	FOR EACH STATEMENT EXECUTE FUNCTION forbid_history_rewrite();
