CREATE SEQUENCE "public"."class_group_code_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
-- 0011's default privileges already cover a sequence the owner creates; said
-- out loud so the panel's role never depends on who ran the migration.
GRANT USAGE, SELECT ON SEQUENCE "public"."class_group_code_seq" TO ooc_app;--> statement-breakpoint
-- Class groups that never had a code (seed, legacy import without a label) get
-- one from the same sequence, oldest first, in the shape of the domain's
-- classGroupCodeOf: 'A-' and the number padded to five digits — never cut
-- (lpad alone would cut past five). Codes that exist stay as they are.
UPDATE "class_groups" AS "g"
SET "code" = 'A-' || lpad("n"."seq"::text, greatest(5, length("n"."seq"::text)), '0')
FROM (
  SELECT "ordered"."id", nextval('class_group_code_seq') AS "seq"
  FROM (SELECT "id" FROM "class_groups" WHERE trim("code") = '' ORDER BY "created_at", "id") AS "ordered"
) AS "n"
WHERE "g"."id" = "n"."id";
