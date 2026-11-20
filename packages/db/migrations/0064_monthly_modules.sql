CREATE TABLE "payment_modules" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"payment_id" uuid NOT NULL,
	"enrollment_id" uuid NOT NULL,
	"module" integer NOT NULL,
	"attempt" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_modules_module_check" CHECK ("payment_modules"."module" > 0),
	CONSTRAINT "payment_modules_attempt_check" CHECK ("payment_modules"."attempt" > 0)
);
--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "billing" text DEFAULT 'package' NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_modules" ADD CONSTRAINT "payment_modules_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_modules" ADD CONSTRAINT "payment_modules_enrollment_id_enrollments_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "public"."enrollments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_modules_payment_module_uidx" ON "payment_modules" USING btree ("payment_id","enrollment_id","module","attempt");--> statement-breakpoint
CREATE INDEX "payment_modules_enrollment_id_idx" ON "payment_modules" USING btree ("enrollment_id","module","attempt");--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_billing_check" CHECK ("plans"."billing" in ('package', 'monthly'));--> statement-breakpoint
-- What a payment bought is history (OOC-86): never edited nor removed. A
-- rejected payment keeps its rows; coverage reads only live payments. Both
-- layers, never one (packages/db/CLAUDE.md).
REVOKE UPDATE, DELETE ON payment_modules FROM ooc_app;
--> statement-breakpoint
DROP TRIGGER IF EXISTS payment_modules_append_only ON payment_modules;
--> statement-breakpoint
CREATE TRIGGER payment_modules_append_only
	BEFORE UPDATE OR DELETE OR TRUNCATE ON payment_modules
	FOR EACH STATEMENT EXECUTE FUNCTION forbid_history_rewrite();
--> statement-breakpoint
-- The monthly plans that already exist are named so: the legacy import made
-- every one "Mensual (por módulo)", and the panel's examples say "Mensual".
-- A plan this misses is marked by creating it again as monthly.
UPDATE plans SET billing = 'monthly' WHERE name ILIKE 'mensual%';
--> statement-breakpoint
-- Before OOC-86 a monthly payment did not say which module it bought. Each
-- monthly enrollment in a numbered run counts its latest live payment as the
-- module and attempt it is in now — the import only brought paid rows, and
-- the module a student studies today is the one they paid for. Nothing else
-- is guessed: the modules before it are not part of anything that is read.
INSERT INTO payment_modules (payment_id, enrollment_id, module, attempt)
SELECT DISTINCT ON (e.id) cov.payment_id, e.id, cgm.module, e.module_attempt
FROM enrollments e
JOIN plan_prices pp ON pp.id = e.plan_price_id
JOIN plans pl ON pl.id = pp.plan_id AND pl.billing = 'monthly'
JOIN class_group_modules cgm ON cgm.id = coalesce(e.class_group_module_id, e.class_group_id)
JOIN payment_coverage cov ON cov.enrollment_id = e.id
JOIN payments p ON p.id = cov.payment_id AND p.status IN ('pending', 'under_review', 'approved')
WHERE cgm.module IS NOT NULL AND e.deleted_at IS NULL
ORDER BY e.id, p.created_at DESC, p.id DESC;
--> statement-breakpoint
ANALYZE plans;
