CREATE TABLE "teacher_availability" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"teacher_id" uuid NOT NULL,
	"weekday" text NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "teacher_availability_weekday_check" CHECK ("teacher_availability"."weekday" in ('mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun')),
	CONSTRAINT "teacher_availability_time_range_check" CHECK ("teacher_availability"."start_time" < "teacher_availability"."end_time")
);
--> statement-breakpoint
CREATE TABLE "teacher_contracts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"teacher_id" uuid NOT NULL,
	"object_key" text NOT NULL,
	"file_name" text NOT NULL,
	"file_size_bytes" integer NOT NULL,
	"starts_on" timestamp with time zone NOT NULL,
	"ends_on" timestamp with time zone NOT NULL,
	"uploaded_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "teacher_contracts_file_size_check" CHECK ("teacher_contracts"."file_size_bytes" > 0),
	CONSTRAINT "teacher_contracts_period_check" CHECK ("teacher_contracts"."starts_on" <= "teacher_contracts"."ends_on")
);
--> statement-breakpoint
CREATE TABLE "teacher_languages" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"teacher_id" uuid NOT NULL,
	"language" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "teachers" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"national_id_type" text NOT NULL,
	"national_id" text NOT NULL,
	"email" text NOT NULL,
	"phone" text NOT NULL,
	"nationality" text NOT NULL,
	"country" text NOT NULL,
	"region" text,
	"city" text NOT NULL,
	"address_line" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "teachers_national_id_type_check" CHECK ("national_id_type" in ('DNI', 'CE', 'passport')),
	CONSTRAINT "teachers_status_check" CHECK ("teachers"."status" in ('active', 'inactive'))
);
--> statement-breakpoint
ALTER TABLE "class_groups" ADD COLUMN "teacher_id" uuid;--> statement-breakpoint
ALTER TABLE "teacher_availability" ADD CONSTRAINT "teacher_availability_teacher_id_teachers_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."teachers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teacher_contracts" ADD CONSTRAINT "teacher_contracts_teacher_id_teachers_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."teachers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teacher_languages" ADD CONSTRAINT "teacher_languages_teacher_id_teachers_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."teachers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "teacher_availability_slot_uidx" ON "teacher_availability" USING btree ("teacher_id","weekday","start_time");--> statement-breakpoint
CREATE UNIQUE INDEX "teacher_contracts_object_key_uidx" ON "teacher_contracts" USING btree ("object_key");--> statement-breakpoint
CREATE INDEX "teacher_contracts_teacher_id_created_at_idx" ON "teacher_contracts" USING btree ("teacher_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "teacher_languages_teacher_id_language_uidx" ON "teacher_languages" USING btree ("teacher_id","language");--> statement-breakpoint
CREATE UNIQUE INDEX "teachers_national_id_uidx" ON "teachers" USING btree ("national_id_type","national_id") WHERE "teachers"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "teachers_user_id_uidx" ON "teachers" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "class_groups" ADD CONSTRAINT "class_groups_teacher_id_teachers_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."teachers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "class_groups_teacher_id_idx" ON "class_groups" USING btree ("teacher_id");--> statement-breakpoint
-- Better Auth's "user" is not in the Drizzle schema (0001), so these two are
-- written by hand, as in 0022. Restrict, never cascade: a teacher file and a
-- filed contract outlive the account that touched them.
ALTER TABLE "teachers" ADD CONSTRAINT "teachers_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE restrict;--> statement-breakpoint
ALTER TABLE "teacher_contracts" ADD CONSTRAINT "teacher_contracts_uploaded_by_user_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "user"("id") ON DELETE restrict;

--> statement-breakpoint
-- teachers joins the delete lock (CLAUDE.md §6): a teacher leaves the roster
-- as `inactive`, never as a deleted row. teacher_contracts is append-only:
-- a filed contract is proof, and correcting it is filing a new one. Both
-- layers, never one of the two (packages/db/CLAUDE.md).
REVOKE DELETE ON teachers FROM ooc_app;
--> statement-breakpoint
DROP TRIGGER IF EXISTS teachers_no_physical_delete ON teachers;
--> statement-breakpoint
CREATE TRIGGER teachers_no_physical_delete
	BEFORE DELETE OR TRUNCATE ON teachers
	FOR EACH STATEMENT EXECUTE FUNCTION forbid_history_rewrite();
--> statement-breakpoint
REVOKE UPDATE, DELETE ON teacher_contracts FROM ooc_app;
--> statement-breakpoint
DROP TRIGGER IF EXISTS teacher_contracts_append_only ON teacher_contracts;
--> statement-breakpoint
CREATE TRIGGER teacher_contracts_append_only
	BEFORE UPDATE OR DELETE OR TRUNCATE ON teacher_contracts
	FOR EACH STATEMENT EXECUTE FUNCTION forbid_history_rewrite();
