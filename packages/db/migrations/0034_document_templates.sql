CREATE TABLE "document_template_drafts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"kind" text NOT NULL,
	"body" text NOT NULL,
	"updated_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_template_versions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"kind" text NOT NULL,
	"version" integer NOT NULL,
	"body" text NOT NULL,
	"published_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_template_versions_version_check" CHECK ("document_template_versions"."version" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "document_template_drafts_kind_uidx" ON "document_template_drafts" USING btree ("kind");--> statement-breakpoint
CREATE UNIQUE INDEX "document_template_versions_kind_version_uidx" ON "document_template_versions" USING btree ("kind","version");--> statement-breakpoint
-- Better Auth's "user" is not in the Drizzle schema (0001), so these two are
-- written by hand, as in 0022/0025. Restrict, never cascade: a published
-- version outlives the account that published it.
ALTER TABLE "document_template_drafts" ADD CONSTRAINT "document_template_drafts_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "user"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "document_template_versions" ADD CONSTRAINT "document_template_versions_published_by_user_id_fk" FOREIGN KEY ("published_by") REFERENCES "user"("id") ON DELETE restrict;
--> statement-breakpoint
-- document_template_versions is append-only (OOC-123): a contract or a
-- certificate was issued from a version, and that version has to keep saying
-- what the text was. Correcting is publishing a new one. Both layers, never
-- one of the two (packages/db/CLAUDE.md).
REVOKE UPDATE, DELETE ON document_template_versions FROM ooc_app;
--> statement-breakpoint
DROP TRIGGER IF EXISTS document_template_versions_append_only ON document_template_versions;
--> statement-breakpoint
CREATE TRIGGER document_template_versions_append_only
	BEFORE UPDATE OR DELETE OR TRUNCATE ON document_template_versions
	FOR EACH STATEMENT EXECUTE FUNCTION forbid_history_rewrite();
