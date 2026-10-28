CREATE TABLE "languages" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "language_id" uuid;--> statement-breakpoint
ALTER TABLE "teacher_languages" ADD COLUMN "language_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "languages_key_live_uidx" ON "languages" USING btree ("key") WHERE "languages"."deleted_at" is null;--> statement-breakpoint
ALTER TABLE "courses" ADD CONSTRAINT "courses_language_id_languages_id_fk" FOREIGN KEY ("language_id") REFERENCES "public"."languages"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teacher_languages" ADD CONSTRAINT "teacher_languages_language_id_languages_id_fk" FOREIGN KEY ("language_id") REFERENCES "public"."languages"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
-- Backfill (OOC-128): one language per spelling the catalog already uses —
-- 0041 left one spelling per key — plus any a teacher holds that no course
-- does. The key is languageKey's (no case, accent or stray space), with
-- `translate` standing in for NFD as in 0041. Courses and teacher languages
-- then point at theirs; the text columns stay as they are.
INSERT INTO "languages" ("name", "key")
SELECT DISTINCT ON ("k") "name", "k"
FROM (
  SELECT trim("language") AS "name", 0 AS "rank",
    lower(translate(regexp_replace(trim("language"), '\s+', ' ', 'g'),
      'ÁÀÂÄÃÉÈÊËÍÌÎÏÓÒÔÖÕÚÙÛÜÑÇáàâäãéèêëíìîïóòôöõúùûüñç',
      'AAAAAEEEEIIIIOOOOOUUUUNCaaaaaeeeeiiiiooooouuuuunc')) AS "k"
  FROM "courses"
  UNION ALL
  SELECT trim("language"), 1,
    lower(translate(regexp_replace(trim("language"), '\s+', ' ', 'g'),
      'ÁÀÂÄÃÉÈÊËÍÌÎÏÓÒÔÖÕÚÙÛÜÑÇáàâäãéèêëíìîïóòôöõúùûüñç',
      'AAAAAEEEEIIIIOOOOOUUUUNCaaaaaeeeeiiiiooooouuuuunc'))
  FROM "teacher_languages"
) AS "spellings"
ORDER BY "k", "rank", "name";--> statement-breakpoint
UPDATE "courses" AS "c" SET "language_id" = "l"."id"
FROM "languages" AS "l"
WHERE "l"."key" = lower(translate(regexp_replace(trim("c"."language"), '\s+', ' ', 'g'),
      'ÁÀÂÄÃÉÈÊËÍÌÎÏÓÒÔÖÕÚÙÛÜÑÇáàâäãéèêëíìîïóòôöõúùûüñç',
      'AAAAAEEEEIIIIOOOOOUUUUNCaaaaaeeeeiiiiooooouuuuunc'));--> statement-breakpoint
UPDATE "teacher_languages" AS "t" SET "language_id" = "l"."id"
FROM "languages" AS "l"
WHERE "l"."key" = lower(translate(regexp_replace(trim("t"."language"), '\s+', ' ', 'g'),
      'ÁÀÂÄÃÉÈÊËÍÌÎÏÓÒÔÖÕÚÙÛÜÑÇáàâäãéèêëíìîïóòôöõúùûüñç',
      'AAAAAEEEEIIIIOOOOOUUUUNCaaaaaeeeeiiiiooooouuuuunc'));--> statement-breakpoint
ANALYZE "courses";--> statement-breakpoint
ANALYZE "teacher_languages";
