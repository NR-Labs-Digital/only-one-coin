-- `courses.language` is free text and the catalog groups by its spelling, so
-- the rows written before the API started reusing the catalog's spelling
-- (catalogSpelling, 27/10/2026) left "INGLES" next to "Inglés" and "FRANCÉS"
-- next to "Francés" — two English groups on Cursos, two chips on the teacher
-- form. Every course of a language now takes one spelling: the one most live
-- courses use (the API's own rule), then the one with most class groups, then
-- one without stray spaces that is not all capitals, then the first in order.
-- Teacher languages follow the courses.
--
-- The key mirrors languageKey (packages/domain/src/catalog/courseLanguage.ts):
-- no case, no accent, no stray space. `translate` covers the Latin accents
-- the catalog uses; it stands in for NFD, which needs the unaccent extension.
WITH "keyed" AS (
  SELECT "id", "language", "deleted_at",
    lower(translate(regexp_replace(trim("language"), '\s+', ' ', 'g'),
      'ÁÀÂÄÃÉÈÊËÍÌÎÏÓÒÔÖÕÚÙÛÜÑÇáàâäãéèêëíìîïóòôöõúùûüñç',
      'AAAAAEEEEIIIIOOOOOUUUUNCaaaaaeeeeiiiiooooouuuuunc')) AS "k"
  FROM "courses"
),
"usage" AS (
  SELECT "c"."k", "c"."language",
    count(DISTINCT "c"."id") FILTER (WHERE "c"."deleted_at" IS NULL) AS "live_courses",
    count("g"."id") AS "class_groups"
  FROM "keyed" AS "c"
  LEFT JOIN "class_groups" AS "g" ON "g"."course_id" = "c"."id" AND "g"."deleted_at" IS NULL
  GROUP BY "c"."k", "c"."language"
),
"canonical" AS (
  SELECT DISTINCT ON ("k") "k", "language"
  FROM "usage"
  ORDER BY "k", "live_courses" DESC, "class_groups" DESC,
    ("language" = trim("language")) DESC, ("language" <> upper("language")) DESC, "language" ASC
)
UPDATE "courses"
SET "language" = "canonical"."language", "updated_at" = now()
FROM "keyed", "canonical"
WHERE "courses"."id" = "keyed"."id"
  AND "keyed"."k" = "canonical"."k"
  AND "courses"."language" <> "canonical"."language";--> statement-breakpoint
-- A teacher cleared for both spellings would hold the same language twice
-- after the rename, which the (teacher_id, language) unique index refuses:
-- keep one row per teacher and language, the catalog's spelling first.
WITH "spelling" AS (
  SELECT DISTINCT
    lower(translate(regexp_replace(trim("language"), '\s+', ' ', 'g'),
      'ÁÀÂÄÃÉÈÊËÍÌÎÏÓÒÔÖÕÚÙÛÜÑÇáàâäãéèêëíìîïóòôöõúùûüñç',
      'AAAAAEEEEIIIIOOOOOUUUUNCaaaaaeeeeiiiiooooouuuuunc')) AS "k",
    "language"
  FROM "courses"
),
"ranked" AS (
  SELECT "t"."id",
    row_number() OVER (
      PARTITION BY "t"."teacher_id", "s"."k"
      ORDER BY ("t"."language" = "s"."language") DESC, "t"."created_at", "t"."id"
    ) AS "n"
  FROM "teacher_languages" AS "t"
  JOIN "spelling" AS "s" ON "s"."k" = lower(translate(regexp_replace(trim("t"."language"), '\s+', ' ', 'g'),
      'ÁÀÂÄÃÉÈÊËÍÌÎÏÓÒÔÖÕÚÙÛÜÑÇáàâäãéèêëíìîïóòôöõúùûüñç',
      'AAAAAEEEEIIIIOOOOOUUUUNCaaaaaeeeeiiiiooooouuuuunc'))
)
DELETE FROM "teacher_languages" WHERE "id" IN (SELECT "id" FROM "ranked" WHERE "n" > 1);--> statement-breakpoint
UPDATE "teacher_languages" AS "t"
SET "language" = "s"."language", "updated_at" = now()
FROM (
  SELECT DISTINCT
    lower(translate(regexp_replace(trim("language"), '\s+', ' ', 'g'),
      'ÁÀÂÄÃÉÈÊËÍÌÎÏÓÒÔÖÕÚÙÛÜÑÇáàâäãéèêëíìîïóòôöõúùûüñç',
      'AAAAAEEEEIIIIOOOOOUUUUNCaaaaaeeeeiiiiooooouuuuunc')) AS "k",
    "language"
  FROM "courses"
) AS "s"
WHERE "s"."k" = lower(translate(regexp_replace(trim("t"."language"), '\s+', ' ', 'g'),
      'ÁÀÂÄÃÉÈÊËÍÌÎÏÓÒÔÖÕÚÙÛÜÑÇáàâäãéèêëíìîïóòôöõúùûüñç',
      'AAAAAEEEEIIIIOOOOOUUUUNCaaaaaeeeeiiiiooooouuuuunc'))
  AND "t"."language" <> "s"."language";
