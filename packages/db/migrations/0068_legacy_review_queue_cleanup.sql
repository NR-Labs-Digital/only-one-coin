-- OOC-184: the legacy import (07/09/2026) left every spreadsheet row it could
-- not settle as an open payment ('under_review', seat 'reserved'), with no
-- receipt attached. Payments opens on the oldest open payment, so those rows
-- sat in front of every real one, and the team asked to start the queue from
-- zero.
--
-- They are settled here as rejected, never deleted (payments has no DELETE,
-- 0011): the row and its trail stay, the queue loses them. No reviewer, no
-- reason code: like the import's PAGOS ERRONEOS bucket, nobody in the panel
-- decided them (payments_rejection_reason_check allows a null reason). No
-- e-mail goes out: a migration never writes to the outbox.
--
-- Only rows the import wrote (`legacy:` idempotency key, run.ts) and still
-- open. A payment the checkout or the panel created never carries that prefix.
UPDATE "enrollments" AS e
SET "seat_status" = 'released', "updated_at" = now()
FROM "payments" AS p
WHERE p."enrollment_id" = e."id"
  AND p."idempotency_key" LIKE 'legacy:%'
  AND p."status" IN ('pending', 'under_review')
  AND e."seat_status" = 'reserved';
--> statement-breakpoint
-- The legacy class groups are 'finished'/'closed' and were created with
-- seats_taken = capacity (legacy-import/catalog.ts): none of them is for sale,
-- so their counters are left as they are.
UPDATE "payments"
SET "status" = 'rejected', "decided_at" = now(), "updated_at" = now()
WHERE "idempotency_key" LIKE 'legacy:%'
  AND "status" IN ('pending', 'under_review');
