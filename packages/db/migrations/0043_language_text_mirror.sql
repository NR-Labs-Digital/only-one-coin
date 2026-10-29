-- OOC-128: the text columns mirror the Language's name while the reads still
-- filter by text (enrollments, teachers, class groups, checkout) — an exact
-- comparison. 0042 named each language with the spelling trimmed but left the
-- text as it was, so a stray space kept "Inglés " from matching the "Inglés"
-- the filters offer. Every linked row takes its language's name.
UPDATE "courses" AS "c"
SET "language" = "l"."name", "updated_at" = now()
FROM "languages" AS "l"
WHERE "c"."language_id" = "l"."id" AND "c"."language" <> "l"."name";--> statement-breakpoint
UPDATE "teacher_languages" AS "t"
SET "language" = "l"."name", "updated_at" = now()
FROM "languages" AS "l"
WHERE "t"."language_id" = "l"."id" AND "t"."language" <> "l"."name";
