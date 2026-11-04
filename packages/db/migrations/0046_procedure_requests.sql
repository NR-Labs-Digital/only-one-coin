CREATE TABLE "procedure_prices" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"kind" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"valid_from" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "procedure_prices_kind_check" CHECK ("procedure_prices"."kind" in ('enrollment_certificate')),
	CONSTRAINT "procedure_prices_amount_cents_check" CHECK ("procedure_prices"."amount_cents" > 0)
);
--> statement-breakpoint
CREATE TABLE "procedure_requests" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"kind" text NOT NULL,
	"student_id" uuid NOT NULL,
	"enrollment_id" uuid NOT NULL,
	"procedure_price_id" uuid NOT NULL,
	"amount_cents" integer NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "procedure_requests_kind_check" CHECK ("procedure_requests"."kind" in ('enrollment_certificate')),
	CONSTRAINT "procedure_requests_amount_cents_check" CHECK ("procedure_requests"."amount_cents" > 0),
	CONSTRAINT "procedure_requests_status_check" CHECK ("procedure_requests"."status" in ('requested', 'paid', 'fulfilled', 'rejected'))
);
--> statement-breakpoint
ALTER TABLE "payments" ALTER COLUMN "enrollment_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "receipt_uploads" ALTER COLUMN "seat_hold_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "procedure_request_id" uuid;--> statement-breakpoint
ALTER TABLE "receipt_uploads" ADD COLUMN "procedure_request_id" uuid;--> statement-breakpoint
ALTER TABLE "procedure_requests" ADD CONSTRAINT "procedure_requests_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procedure_requests" ADD CONSTRAINT "procedure_requests_enrollment_id_enrollments_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "public"."enrollments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procedure_requests" ADD CONSTRAINT "procedure_requests_procedure_price_id_procedure_prices_id_fk" FOREIGN KEY ("procedure_price_id") REFERENCES "public"."procedure_prices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "procedure_prices_kind_valid_from_idx" ON "procedure_prices" USING btree ("kind","valid_from");--> statement-breakpoint
CREATE UNIQUE INDEX "procedure_requests_live_uidx" ON "procedure_requests" USING btree ("enrollment_id","kind") WHERE "procedure_requests"."status" in ('requested', 'paid');--> statement-breakpoint
CREATE INDEX "procedure_requests_student_id_idx" ON "procedure_requests" USING btree ("student_id");--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_procedure_request_id_procedure_requests_id_fk" FOREIGN KEY ("procedure_request_id") REFERENCES "public"."procedure_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_uploads" ADD CONSTRAINT "receipt_uploads_procedure_request_id_procedure_requests_id_fk" FOREIGN KEY ("procedure_request_id") REFERENCES "public"."procedure_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payments_procedure_request_id_uidx" ON "payments" USING btree ("procedure_request_id") WHERE "payments"."procedure_request_id" is not null;--> statement-breakpoint
CREATE INDEX "receipt_uploads_procedure_request_id_idx" ON "receipt_uploads" USING btree ("procedure_request_id") WHERE "receipt_uploads"."procedure_request_id" is not null;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_origin_check" CHECK (num_nonnulls("enrollment_id", "procedure_request_id") = 1);--> statement-breakpoint
ALTER TABLE "receipt_uploads" ADD CONSTRAINT "receipt_uploads_owner_check" CHECK (num_nonnulls("seat_hold_id", "procedure_request_id") = 1);--> statement-breakpoint
-- The price the settings screen was showing becomes the first version: the
-- constancia costs tomorrow what it cost today. `constancia_fee_cents` stays
-- until the contract step (CLAUDE.md §7) and nothing reads it any more.
-- `coalesce` for a database whose settings row was never written: the column's
-- default, the same number the code used to fall back to.
INSERT INTO "procedure_prices" ("kind", "amount_cents")
SELECT 'enrollment_certificate', coalesce((SELECT "constancia_fee_cents" FROM "platform_settings" LIMIT 1), 2500);
--> statement-breakpoint
-- Hand-written, as in 0022, 0025, 0027 and 0031: Better Auth's "user" is not in
-- the Drizzle schema. Restrict: who set a price outlives the account.
ALTER TABLE "procedure_prices" ADD CONSTRAINT "procedure_prices_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "user"("id") ON DELETE restrict;
--> statement-breakpoint
-- procedure_prices joins the append-only lock, like plan_prices (0017). Both
-- layers, never one of the two (packages/db/CLAUDE.md).
REVOKE UPDATE, DELETE ON procedure_prices FROM ooc_app;
--> statement-breakpoint
DROP TRIGGER IF EXISTS procedure_prices_append_only ON procedure_prices;
--> statement-breakpoint
CREATE TRIGGER procedure_prices_append_only
	BEFORE UPDATE OR DELETE OR TRUNCATE ON procedure_prices
	FOR EACH STATEMENT EXECUTE FUNCTION forbid_history_rewrite();
--> statement-breakpoint
-- procedure_requests joins the delete lock: a request is what a payment paid
-- for. UPDATE stays — its status moves.
REVOKE DELETE ON procedure_requests FROM ooc_app;
--> statement-breakpoint
DROP TRIGGER IF EXISTS procedure_requests_no_physical_delete ON procedure_requests;
--> statement-breakpoint
CREATE TRIGGER procedure_requests_no_physical_delete
	BEFORE DELETE OR TRUNCATE ON procedure_requests
	FOR EACH STATEMENT EXECUTE FUNCTION forbid_history_rewrite();
--> statement-breakpoint
-- The new columns enter WHERE and joins (packages/db/CLAUDE.md).
ANALYZE payments;
--> statement-breakpoint
ANALYZE receipt_uploads;
