CREATE TABLE "payment_lot_enrollments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"payment_id" uuid NOT NULL,
	"enrollment_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payment_lot_enrollments" ADD CONSTRAINT "payment_lot_enrollments_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_lot_enrollments" ADD CONSTRAINT "payment_lot_enrollments_enrollment_id_enrollments_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "public"."enrollments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_lot_enrollments_enrollment_id_uidx" ON "payment_lot_enrollments" USING btree ("enrollment_id");--> statement-breakpoint
CREATE INDEX "payment_lot_enrollments_payment_id_idx" ON "payment_lot_enrollments" USING btree ("payment_id");--> statement-breakpoint
-- What a payment paid for is history (OOC-158): a lot item is never edited
-- nor removed — a rejected lot keeps its rows, its seats go back. Both layers,
-- never one (packages/db/CLAUDE.md).
REVOKE UPDATE, DELETE ON payment_lot_enrollments FROM ooc_app;
--> statement-breakpoint
DROP TRIGGER IF EXISTS payment_lot_enrollments_append_only ON payment_lot_enrollments;
--> statement-breakpoint
CREATE TRIGGER payment_lot_enrollments_append_only
	BEFORE UPDATE OR DELETE OR TRUNCATE ON payment_lot_enrollments
	FOR EACH STATEMENT EXECUTE FUNCTION forbid_history_rewrite();
--> statement-breakpoint
-- Every enrollment a payment pays for, one row each: its own enrollment_id,
-- plus the other items of its lot. UNION ALL is exact — the lot table never
-- repeats the payment's own enrollment — and lets the planner push a filter on
-- either column into both branches.
CREATE VIEW "payment_coverage" AS
SELECT p.id AS payment_id, p.enrollment_id
FROM payments p
WHERE p.enrollment_id IS NOT NULL
UNION ALL
SELECT l.payment_id, l.enrollment_id
FROM payment_lot_enrollments l;
--> statement-breakpoint
GRANT SELECT ON "payment_coverage" TO ooc_app;
