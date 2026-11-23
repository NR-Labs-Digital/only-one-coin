ALTER TABLE "class_groups" ADD COLUMN "erased_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "class_groups" ADD CONSTRAINT "class_groups_erased_check" CHECK ("class_groups"."erased_at" is null or "class_groups"."deleted_at" is not null);
--> statement-breakpoint
-- The list and every catalog read filter on it (packages/db CLAUDE.md, ANALYZE rule).
ANALYZE "class_groups";
