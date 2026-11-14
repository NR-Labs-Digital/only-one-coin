ALTER TABLE "class_groups" ADD COLUMN "seats_over" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "enrollments" ADD COLUMN "over_capacity" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "class_groups" ADD CONSTRAINT "class_groups_seats_over_check" CHECK ("class_groups"."seats_over" >= 0);--> statement-breakpoint
ANALYZE "class_groups";
