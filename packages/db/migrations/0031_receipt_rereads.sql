CREATE TABLE "receipt_rereads" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"payment_id" uuid NOT NULL,
	"receipt_upload_id" uuid NOT NULL,
	"requested_by" text NOT NULL,
	"tier" integer NOT NULL,
	"model_name" text,
	"model_version" text,
	"amount_cents" integer,
	"operation_number" text,
	"extracted_fields" jsonb,
	"failure_reason" text,
	"validation_verdict" text,
	"validation_detail" jsonb,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "receipt_rereads_validation_verdict_check" CHECK ("receipt_rereads"."validation_verdict" is null or "receipt_rereads"."validation_verdict" in ('approve', 'review', 'reject_suggested')),
	CONSTRAINT "receipt_rereads_read_stamp_check" CHECK (("receipt_rereads"."read_at" is null) = ("receipt_rereads"."validation_verdict" is null))
);
--> statement-breakpoint
ALTER TABLE "receipt_rereads" ADD CONSTRAINT "receipt_rereads_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_rereads" ADD CONSTRAINT "receipt_rereads_receipt_upload_id_receipt_uploads_id_fk" FOREIGN KEY ("receipt_upload_id") REFERENCES "public"."receipt_uploads"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "receipt_rereads_pending_uidx" ON "receipt_rereads" USING btree ("receipt_upload_id") WHERE "receipt_rereads"."read_at" is null;--> statement-breakpoint
CREATE INDEX "receipt_rereads_receipt_upload_id_idx" ON "receipt_rereads" USING btree ("receipt_upload_id","read_at");--> statement-breakpoint
CREATE INDEX "receipt_rereads_pending_created_at_idx" ON "receipt_rereads" USING btree ("created_at") WHERE "receipt_rereads"."read_at" is null;--> statement-breakpoint
-- Better Auth's "user" is not in the Drizzle schema (0001), so this one is
-- written by hand, as in 0022, 0025 and 0027. Restrict: who asked for a
-- reading outlives the account.
ALTER TABLE "receipt_rereads" ADD CONSTRAINT "receipt_rereads_requested_by_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "user"("id") ON DELETE restrict;
--> statement-breakpoint
-- receipt_rereads joins the delete lock (CLAUDE.md §6), like payment_receipts:
-- what the model read off a receipt is part of the payment's record. UPDATE
-- stays — the worker fills the row once, guarded by `read_at is null`. Both
-- layers, never one of the two (packages/db/CLAUDE.md).
REVOKE DELETE ON receipt_rereads FROM ooc_app;
--> statement-breakpoint
DROP TRIGGER IF EXISTS receipt_rereads_no_physical_delete ON receipt_rereads;
--> statement-breakpoint
CREATE TRIGGER receipt_rereads_no_physical_delete
	BEFORE DELETE OR TRUNCATE ON receipt_rereads
	FOR EACH STATEMENT EXECUTE FUNCTION forbid_history_rewrite();
