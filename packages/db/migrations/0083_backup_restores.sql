CREATE TABLE "backup_restores" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"backup_key" text NOT NULL,
	"database_name" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"failure_reason" text,
	"report" jsonb,
	"requested_by" text NOT NULL,
	"started_at" timestamp with time zone,
	"heartbeat_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"discarded_at" timestamp with time zone,
	"discarded_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "backup_restores_database_name_unique" UNIQUE("database_name"),
	CONSTRAINT "backup_restores_status_check" CHECK ("backup_restores"."status" in ('queued', 'restoring', 'validating', 'passed', 'failed', 'discarded')),
	CONSTRAINT "backup_restores_failure_check" CHECK (("backup_restores"."status" = 'failed') = ("backup_restores"."failure_reason" is not null)),
	CONSTRAINT "backup_restores_discard_check" CHECK (("backup_restores"."status" = 'discarded') = ("backup_restores"."discarded_at" is not null) and ("backup_restores"."discarded_at" is null) = ("backup_restores"."discarded_by" is null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "backup_restores_one_open_uidx" ON "backup_restores" USING btree ((true)) WHERE "backup_restores"."status" in ('queued', 'restoring', 'validating', 'passed');--> statement-breakpoint
CREATE INDEX "backup_restores_created_at_idx" ON "backup_restores" USING btree ("created_at");--> statement-breakpoint
-- Better Auth's "user" is not in the Drizzle schema (0001), so these are
-- written by hand, as in 0031. Restrict: who restored a backup outlives the
-- account.
ALTER TABLE "backup_restores" ADD CONSTRAINT "backup_restores_requested_by_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "user"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "backup_restores" ADD CONSTRAINT "backup_restores_discarded_by_user_id_fk" FOREIGN KEY ("discarded_by") REFERENCES "user"("id") ON DELETE restrict;
