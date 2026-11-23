CREATE TABLE "issued_document_revocations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"issued_document_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"revoked_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "issued_document_revocations_reason_check" CHECK (length(btrim("issued_document_revocations"."reason")) between 1 and 500)
);
--> statement-breakpoint
DROP INDEX "issued_documents_certificate_enrollment_uidx";--> statement-breakpoint
ALTER TABLE "issued_documents" ADD COLUMN "replaces_id" uuid;--> statement-breakpoint
ALTER TABLE "issued_document_revocations" ADD CONSTRAINT "issued_document_revocations_issued_document_id_issued_documents_id_fk" FOREIGN KEY ("issued_document_id") REFERENCES "public"."issued_documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "issued_document_revocations_document_uidx" ON "issued_document_revocations" USING btree ("issued_document_id");--> statement-breakpoint
ALTER TABLE "issued_documents" ADD CONSTRAINT "issued_documents_replaces_id_issued_documents_id_fk" FOREIGN KEY ("replaces_id") REFERENCES "public"."issued_documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "issued_documents_certificate_first_uidx" ON "issued_documents" USING btree ("enrollment_id") WHERE "issued_documents"."kind" = 'certificate' and "issued_documents"."replaces_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "issued_documents_replaces_uidx" ON "issued_documents" USING btree ("replaces_id") WHERE "issued_documents"."replaces_id" is not null;--> statement-breakpoint
-- Better Auth's "user" lives outside schema.ts: the FK is written by hand, as
-- in 0062. Revoking is always a person.
ALTER TABLE "issued_document_revocations" ADD CONSTRAINT "issued_document_revocations_revoked_by_user_fk" FOREIGN KEY ("revoked_by") REFERENCES "user"("id") ON DELETE restrict;
--> statement-breakpoint
-- A revocation is history (OOC-59): the validation page answers by it, so it
-- is never rewritten nor removed. Both layers, never one (packages/db/CLAUDE.md).
REVOKE UPDATE, DELETE ON issued_document_revocations FROM ooc_app;
--> statement-breakpoint
DROP TRIGGER IF EXISTS issued_document_revocations_append_only ON issued_document_revocations;
--> statement-breakpoint
CREATE TRIGGER issued_document_revocations_append_only
	BEFORE UPDATE OR DELETE OR TRUNCATE ON issued_document_revocations
	FOR EACH STATEMENT EXECUTE FUNCTION forbid_history_rewrite();
--> statement-breakpoint
-- replaces_id enters WHERE (the status of every document is read by it).
ANALYZE issued_documents;
