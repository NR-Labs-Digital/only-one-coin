CREATE TABLE "email_template_drafts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"template_key" text NOT NULL,
	"content" jsonb NOT NULL,
	"updated_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_template_versions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"template_key" text NOT NULL,
	"version" integer NOT NULL,
	"content" jsonb NOT NULL,
	"repository_version" text NOT NULL,
	"published_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_template_versions_version_check" CHECK ("email_template_versions"."version" > 0)
);
--> statement-breakpoint
ALTER TABLE "outbox" ADD COLUMN "template_version_id" uuid;--> statement-breakpoint
ALTER TABLE "outbox" ADD COLUMN "template_copy" jsonb;--> statement-breakpoint
CREATE UNIQUE INDEX "email_template_drafts_template_key_uidx" ON "email_template_drafts" USING btree ("template_key");--> statement-breakpoint
CREATE UNIQUE INDEX "email_template_versions_template_key_version_uidx" ON "email_template_versions" USING btree ("template_key","version");--> statement-breakpoint
ALTER TABLE "outbox" ADD CONSTRAINT "outbox_template_version_id_email_template_versions_id_fk" FOREIGN KEY ("template_version_id") REFERENCES "public"."email_template_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox" ADD CONSTRAINT "outbox_template_copy_check" CHECK ("outbox"."template_copy" is null or "outbox"."is_proof");--> statement-breakpoint
-- Better Auth's "user" is not in the Drizzle schema (0001), so these two are
-- written by hand, as in 0034. Restrict, never cascade: a published version
-- outlives the account that published it.
ALTER TABLE "email_template_drafts" ADD CONSTRAINT "email_template_drafts_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "user"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "email_template_versions" ADD CONSTRAINT "email_template_versions_published_by_user_id_fk" FOREIGN KEY ("published_by") REFERENCES "user"("id") ON DELETE restrict;
--> statement-breakpoint
-- email_template_versions is append-only (OOC-60): an outbox row says which
-- version a student received, and that version has to keep saying what the
-- words were. Correcting is publishing a new one. Both layers, never one of
-- the two (packages/db/CLAUDE.md).
REVOKE UPDATE, DELETE ON email_template_versions FROM ooc_app;
--> statement-breakpoint
DROP TRIGGER IF EXISTS email_template_versions_append_only ON email_template_versions;
--> statement-breakpoint
CREATE TRIGGER email_template_versions_append_only
	BEFORE UPDATE OR DELETE OR TRUNCATE ON email_template_versions
	FOR EACH STATEMENT EXECUTE FUNCTION forbid_history_rewrite();
