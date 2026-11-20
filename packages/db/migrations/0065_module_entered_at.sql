ALTER TABLE "enrollments" ADD COLUMN "module_entered_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
-- Nothing recorded when a seat entered its run before this. The row's last
-- change is the nearest fact: progression and moves write it, and a seat that
-- never moved last changed around its approval. Close enough for "owes the
-- module since"; every move from now on writes the real instant.
UPDATE "enrollments" SET "module_entered_at" = "updated_at";
