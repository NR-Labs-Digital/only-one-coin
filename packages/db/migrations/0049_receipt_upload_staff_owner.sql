-- OOC-146: a manual backoffice enrollment uploads a real receipt, which goes
-- up before the enrollment and its payment exist. Its owner until then is the
-- staff account that started the upload — a third option next to the
-- checkout's seat hold and the portal's procedure request. Existing rows all
-- have one of the first two, so the widened CHECK holds for them as is.
ALTER TABLE "receipt_uploads" ADD COLUMN "uploaded_by" text;--> statement-breakpoint
ALTER TABLE "receipt_uploads" ADD CONSTRAINT "receipt_uploads_uploaded_by_user_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "user"("id") ON DELETE restrict;--> statement-breakpoint
ALTER TABLE "receipt_uploads" DROP CONSTRAINT "receipt_uploads_owner_check";--> statement-breakpoint
ALTER TABLE "receipt_uploads" ADD CONSTRAINT "receipt_uploads_owner_check" CHECK (num_nonnulls("seat_hold_id", "procedure_request_id", "uploaded_by") = 1);
