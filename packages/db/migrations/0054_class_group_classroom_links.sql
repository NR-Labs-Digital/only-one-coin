-- One Classroom per module the class group teaches (OOC-144, replaces the one
-- link per class group of OOC-98 / 0038). Module number (text, JSON keys are
-- text) → link. "classroom_url" stays: class groups with no module set keep
-- reading it until coordination picks the module, and dropping it is the
-- contract step, weeks from now (CLAUDE.md §7).
ALTER TABLE "class_groups" ADD COLUMN "classroom_links" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "class_groups" ADD CONSTRAINT "class_groups_classroom_links_check" CHECK (jsonb_typeof("class_groups"."classroom_links") = 'object');--> statement-breakpoint
-- A class group that teaches one module: its link is that module's.
UPDATE "class_groups"
   SET "classroom_links" = jsonb_build_object("module"::text, "classroom_url")
 WHERE "classroom_url" IS NOT NULL AND "module" IS NOT NULL;--> statement-breakpoint
-- A full-course class group (OOC-130) had one Classroom for the whole course:
-- every module of the course starts on it, and coordination changes each one
-- from there.
UPDATE "class_groups" cg
   SET "classroom_links" = (
         SELECT jsonb_object_agg(n::text, cg."classroom_url")
           FROM generate_series(1, c."modules") AS n
       )
  FROM "courses" c
 WHERE c."id" = cg."course_id" AND cg."full_course" AND cg."classroom_url" IS NOT NULL;
