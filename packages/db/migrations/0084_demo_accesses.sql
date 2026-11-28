CREATE TABLE "demo_accesses" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"kind" text NOT NULL,
	"email" text NOT NULL,
	"class_group_id" uuid NOT NULL,
	"student_id" uuid,
	"teacher_id" uuid,
	"created_by" text NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "demo_accesses_kind_check" CHECK ("demo_accesses"."kind" in ('student', 'teacher')),
	CONSTRAINT "demo_accesses_owner_check" CHECK (("demo_accesses"."kind" = 'student' and "demo_accesses"."student_id" is not null and "demo_accesses"."teacher_id" is null) or ("demo_accesses"."kind" = 'teacher' and "demo_accesses"."teacher_id" is not null and "demo_accesses"."student_id" is null)),
	CONSTRAINT "demo_accesses_revoke_check" CHECK (("demo_accesses"."revoked_at" is null) = ("demo_accesses"."revoked_by" is null))
);
--> statement-breakpoint
ALTER TABLE "class_groups" ADD COLUMN "is_demo" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "is_demo" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "teachers" ADD COLUMN "is_demo" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "demo_accesses" ADD CONSTRAINT "demo_accesses_class_group_id_class_groups_id_fk" FOREIGN KEY ("class_group_id") REFERENCES "public"."class_groups"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_accesses" ADD CONSTRAINT "demo_accesses_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_accesses" ADD CONSTRAINT "demo_accesses_teacher_id_teachers_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."teachers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "demo_accesses_created_at_idx" ON "demo_accesses" USING btree ("created_at");--> statement-breakpoint
-- "user" is Better Auth's table, outside the Drizzle schema: these two foreign
-- keys are written by hand, as in 0083. Restrict: who opened or revoked a demo
-- access outlives the account.
ALTER TABLE "demo_accesses" ADD CONSTRAINT "demo_accesses_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "user"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "demo_accesses" ADD CONSTRAINT "demo_accesses_revoked_by_user_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "user"("id") ON DELETE restrict;
