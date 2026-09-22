-- Gives the catalog, the enrollment and the guardian the replacement for a
-- delete they never had: migration 0011 refuses the physical one, and until
-- now only `students` had somewhere for a retired row to go.
--
-- Additive (CLAUDE.md §7): six nullable columns, every existing row keeps
-- answering for itself. Deliberately absent from plan_prices, consents and
-- audit_log — those are append-only, and a `deleted_at` there would be a way
-- to hide what the platform promises to keep (see src/schema.ts, base schema).
ALTER TABLE "academic_periods" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "class_groups" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "enrollments" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "guardians" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "deleted_at" timestamp with time zone;