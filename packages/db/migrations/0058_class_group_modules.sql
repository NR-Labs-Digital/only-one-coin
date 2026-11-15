CREATE TABLE "class_group_modules" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"class_group_id" uuid NOT NULL,
	"module" integer,
	"full_course" boolean DEFAULT false NOT NULL,
	"teacher_id" uuid,
	"teacher_name" text DEFAULT '' NOT NULL,
	"slots" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"classroom_links" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"classroom_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "class_group_modules_module_check" CHECK ("class_group_modules"."module" is null or "class_group_modules"."module" > 0),
	CONSTRAINT "class_group_modules_full_course_check" CHECK (not "class_group_modules"."full_course" or "class_group_modules"."module" is null),
	CONSTRAINT "class_group_modules_classroom_links_check" CHECK (jsonb_typeof("class_group_modules"."classroom_links") = 'object')
);
--> statement-breakpoint
ALTER TABLE "enrollments" ADD COLUMN "class_group_module_id" uuid;--> statement-breakpoint
ALTER TABLE "class_group_modules" ADD CONSTRAINT "class_group_modules_class_group_id_class_groups_id_fk" FOREIGN KEY ("class_group_id") REFERENCES "public"."class_groups"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_group_modules" ADD CONSTRAINT "class_group_modules_teacher_id_teachers_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."teachers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "class_group_modules_module_live_uidx" ON "class_group_modules" USING btree ("class_group_id","module") WHERE "class_group_modules"."deleted_at" is null and "class_group_modules"."module" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "class_group_modules_unnumbered_live_uidx" ON "class_group_modules" USING btree ("class_group_id") WHERE "class_group_modules"."deleted_at" is null and "class_group_modules"."module" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "class_group_modules_id_class_group_uidx" ON "class_group_modules" USING btree ("id","class_group_id");--> statement-breakpoint
CREATE INDEX "class_group_modules_class_group_id_idx" ON "class_group_modules" USING btree ("class_group_id");--> statement-breakpoint
CREATE INDEX "class_group_modules_teacher_id_idx" ON "class_group_modules" USING btree ("teacher_id");--> statement-breakpoint
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_class_group_module_fk" FOREIGN KEY ("class_group_module_id","class_group_id") REFERENCES "public"."class_group_modules"("id","class_group_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "enrollments_class_group_module_id_idx" ON "enrollments" USING btree ("class_group_module_id");--> statement-breakpoint
-- Backfill (OOC-156): every class group becomes one module run carrying its
-- own teaching columns, under the class group's own id — teacher bookmarks,
-- grades waiting in a device outbox and enrollments keep resolving to the
-- right run. A retired class group's run stays live: the class group is what
-- is retired.
INSERT INTO "class_group_modules" (
	"id", "class_group_id", "module", "full_course", "teacher_id", "teacher_name",
	"slots", "classroom_links", "classroom_url", "created_at", "updated_at"
)
SELECT
	"id", "id", "module", "full_course", "teacher_id", "teacher_name",
	"slots", "classroom_links", "classroom_url", "created_at", "updated_at"
FROM "class_groups";--> statement-breakpoint
UPDATE "enrollments" SET "class_group_module_id" = "class_group_id" WHERE "class_group_module_id" IS NULL;--> statement-breakpoint
ANALYZE "class_group_modules";--> statement-breakpoint
ANALYZE "enrollments";
