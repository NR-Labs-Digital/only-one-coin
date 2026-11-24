CREATE TABLE "staff_permission_seeds" (
	"permission" text PRIMARY KEY NOT NULL,
	"seeded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff_profile_permissions" (
	"profile_id" uuid NOT NULL,
	"permission" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_profile_permissions_profile_id_permission_pk" PRIMARY KEY("profile_id","permission")
);
--> statement-breakpoint
CREATE TABLE "staff_profiles" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"role_key" text,
	"name" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "staff_profiles_kind_check" CHECK (num_nonnulls("staff_profiles"."role_key", "staff_profiles"."name") = 1),
	CONSTRAINT "staff_profiles_board_live_check" CHECK ("staff_profiles"."role_key" is null or "staff_profiles"."deleted_at" is null),
	CONSTRAINT "staff_profiles_role_key_check" CHECK ("staff_profiles"."role_key" is null or "staff_profiles"."role_key" in ('master', 'admin', 'analyst', 'enrollment_supervisor', 'academic_supervisor', 'academic_assistant', 'teacher', 'sales', 'support', 'billing'))
);
--> statement-breakpoint
ALTER TABLE "staff_invites" DROP CONSTRAINT "staff_invites_role_check";--> statement-breakpoint
ALTER TABLE "staff_invites" ADD COLUMN "profile_id" uuid;--> statement-breakpoint
ALTER TABLE "staff_profile_permissions" ADD CONSTRAINT "staff_profile_permissions_profile_id_staff_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."staff_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "staff_profiles_role_key_uidx" ON "staff_profiles" USING btree ("role_key");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_profiles_name_live_uidx" ON "staff_profiles" USING btree (lower("name")) WHERE "staff_profiles"."deleted_at" is null and "staff_profiles"."name" is not null;--> statement-breakpoint
ALTER TABLE "staff_invites" ADD CONSTRAINT "staff_invites_profile_id_staff_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."staff_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_invites" ADD CONSTRAINT "staff_invites_profile_check" CHECK (("staff_invites"."role" = 'custom') = ("staff_invites"."profile_id" is not null));--> statement-breakpoint
ALTER TABLE "staff_invites" ADD CONSTRAINT "staff_invites_role_check" CHECK ("staff_invites"."role" in ('master', 'admin', 'analyst', 'enrollment_supervisor', 'academic_supervisor', 'academic_assistant', 'teacher', 'sales', 'support', 'billing', 'custom'));--> statement-breakpoint
-- OOC-183: an account on a cargo created in Equipo carries the `custom` role
-- and points at it. "user" lives outside the Drizzle schema (Better Auth owns
-- it), so its column, FK and CHECKs are written by hand, as 0009 and 0075 did.
ALTER TABLE "user" ADD COLUMN "profile_id" uuid;--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_profile_id_staff_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."staff_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user" DROP CONSTRAINT "user_role_check";--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_role_check" CHECK ("role" in ('master', 'admin', 'analyst', 'enrollment_supervisor', 'academic_supervisor', 'academic_assistant', 'teacher', 'sales', 'support', 'billing', 'custom', 'student', 'guardian'));--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_profile_check" CHECK (("role" = 'custom') = ("profile_id" is not null));--> statement-breakpoint
-- The members of a cargo are counted by this column (refusing to retire a cargo still in use).
CREATE INDEX "user_profile_id_idx" ON "user" ("profile_id") WHERE "profile_id" is not null;--> statement-breakpoint
ANALYZE "user";--> statement-breakpoint
ANALYZE "staff_invites";
