CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"owner_type" text NOT NULL,
	"owner_id" uuid NOT NULL,
	"category" text NOT NULL,
	"object_key" text NOT NULL,
	"original_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer,
	"checksum_sha256" text,
	"source" text NOT NULL,
	"uploaded_by" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"rejection_reason" text,
	"uploaded_at" timestamp with time zone,
	"removed_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "documents_status_check" CHECK ("documents"."status" in ('pending', 'uploaded', 'rejected', 'removed')),
	CONSTRAINT "documents_source_check" CHECK ("documents"."source" in ('portal', 'backoffice')),
	CONSTRAINT "documents_size_bytes_check" CHECK ("documents"."size_bytes" is null or "documents"."size_bytes" > 0),
	CONSTRAINT "documents_uploaded_check" CHECK (("documents"."status" in ('uploaded', 'removed')) = ("documents"."uploaded_at" is not null and "documents"."size_bytes" is not null and "documents"."checksum_sha256" is not null)),
	CONSTRAINT "documents_rejection_check" CHECK (("documents"."status" = 'rejected') = ("documents"."rejection_reason" is not null)),
	CONSTRAINT "documents_removed_check" CHECK (("documents"."status" = 'removed') = ("documents"."deleted_at" is not null) and ("documents"."status" = 'removed') = ("documents"."removed_by" is not null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "documents_object_key_uidx" ON "documents" USING btree ("object_key");--> statement-breakpoint
CREATE INDEX "documents_owner_idx" ON "documents" USING btree ("owner_type","owner_id","created_at") WHERE "documents"."status" = 'uploaded' and "documents"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "documents_pending_idx" ON "documents" USING btree ("created_at") WHERE "documents"."status" = 'pending';--> statement-breakpoint
-- Hand-written, as in 0022, 0025, 0027, 0031 and 0046: Better Auth's "user" is
-- not in the Drizzle schema. Restrict: who sent or removed a file outlives the
-- account.
ALTER TABLE "documents" ADD CONSTRAINT "documents_uploaded_by_user_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "user"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_removed_by_user_id_fk" FOREIGN KEY ("removed_by") REFERENCES "user"("id") ON DELETE restrict;
--> statement-breakpoint
-- documents joins the delete lock: removing a file is `deleted_at`, never a
-- DELETE. Both layers, never one of the two (packages/db/CLAUDE.md). UPDATE
-- stays — the status moves.
REVOKE DELETE ON documents FROM ooc_app;
--> statement-breakpoint
DROP TRIGGER IF EXISTS documents_no_physical_delete ON documents;
--> statement-breakpoint
CREATE TRIGGER documents_no_physical_delete
	BEFORE DELETE OR TRUNCATE ON documents
	FOR EACH STATEMENT EXECUTE FUNCTION forbid_history_rewrite();
