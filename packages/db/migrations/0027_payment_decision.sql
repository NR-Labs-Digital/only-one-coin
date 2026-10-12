ALTER TABLE "payments" ADD COLUMN "decided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "decided_by" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "rejection_reason" text;--> statement-breakpoint
-- Backfill (OOC-112), before any constraint, so the CHECKs below are born
-- valid over filled rows. The decision that speaks for a payment is its
-- latest approval or rejection in the audit trail — the same rule
-- ListPaymentsQuery applied on every read until now. The actor is kept only
-- when it is still an account, or the FK below would refuse the row; the
-- reason only on a rejection, and only a known code.
WITH "decision" AS (
	SELECT DISTINCT ON ("target_id") "target_id", "actor_id", "created_at", "metadata"
	FROM "audit_log"
	WHERE "action" IN ('payment.approved', 'payment.rejected')
	ORDER BY "target_id", "created_at" DESC
)
UPDATE "payments" AS "p"
SET
	"decided_at" = "d"."created_at",
	"decided_by" = (SELECT "u"."id" FROM "user" AS "u" WHERE "u"."id" = "d"."actor_id"),
	"rejection_reason" = CASE
		WHEN "p"."status" = 'rejected'
			AND "d"."metadata"->>'reason' IN ('amount_mismatch', 'illegible', 'duplicate', 'not_a_receipt', 'other')
		THEN "d"."metadata"->>'reason'
	END
FROM "decision" AS "d"
WHERE "d"."target_id" = "p"."id"::text
	AND "p"."status" IN ('approved', 'rejected');--> statement-breakpoint
-- Decided with no trail: the seed and the legacy import write approved and
-- rejected rows directly. Their last write is the best date there is; nobody
-- is named, and no reason is made up.
UPDATE "payments"
SET "decided_at" = "updated_at"
WHERE "status" IN ('approved', 'rejected') AND "decided_at" IS NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_decided_at_check" CHECK (("status" in ('approved', 'rejected')) = ("decided_at" is not null));--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_decided_by_check" CHECK ("decided_by" is null or "decided_at" is not null);--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_rejection_reason_check" CHECK ("rejection_reason" is null or ("status" = 'rejected' and "rejection_reason" in ('amount_mismatch', 'illegible', 'duplicate', 'not_a_receipt', 'other')));--> statement-breakpoint
-- Better Auth's "user" is not in the Drizzle schema (0001), so this one is
-- written by hand, as in 0022 and 0025. Restrict: a decision outlives the
-- account that made it.
ALTER TABLE "payments" ADD CONSTRAINT "payments_decided_by_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "user"("id") ON DELETE restrict;--> statement-breakpoint
CREATE INDEX "enrollments_confirmed_class_group_id_idx" ON "enrollments" USING btree ("class_group_id") WHERE "enrollments"."seat_status" = 'confirmed' and "enrollments"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "payments_open_created_at_idx" ON "payments" USING btree ("created_at") WHERE "payments"."status" in ('pending', 'under_review');
