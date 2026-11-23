-- OOC-185: COREANO DESDE CERO got the same plan twice on 20/10/2026 — two
-- COREANO BASICO, S/ 70, created by the same account 8.7 s apart, neither ever
-- sold. Retires the newer one, the same write as *Retirar* in the panel
-- (deleted_at), so it leaves the checkout and can still be restored there.
--
-- Pinned to the production id and guarded: in any other database (local, CI,
-- staging) the id does not exist and nothing happens; in production it only
-- runs if the plan is still live, its twin is live, and no enrollment ever
-- pointed at it.
UPDATE "plans" AS p
SET "deleted_at" = now(), "updated_at" = now()
WHERE p."id" = '01a159f3-943d-747c-933b-49413ae21ff2'
  AND p."deleted_at" IS NULL
  AND EXISTS (
    SELECT 1 FROM "plans" AS twin
    WHERE twin."id" = '01a159f3-720b-779b-af22-91fb587ed4ef'
      AND twin."course_id" = p."course_id"
      AND twin."name" = p."name"
      AND twin."deleted_at" IS NULL
  )
  AND NOT EXISTS (
    SELECT 1 FROM "enrollments" AS e
    JOIN "plan_prices" AS pp ON pp."id" = e."plan_price_id"
    WHERE pp."plan_id" = p."id"
  );
