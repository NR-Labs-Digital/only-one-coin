-- OOC-79: a `teacher` invite names the teacher file it opens an account for.
ALTER TABLE "staff_invites" ADD COLUMN "teacher_id" uuid;--> statement-breakpoint
ALTER TABLE "staff_invites" ADD CONSTRAINT "staff_invites_teacher_id_teachers_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."teachers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "staff_invites_pending_teacher_uidx" ON "staff_invites" USING btree ("teacher_id") WHERE "staff_invites"."status" = 'pending';--> statement-breakpoint
-- A pending `teacher` invite from before this migration names no file, so
-- accepting it could only open an account linked to nobody. Cancelled here so
-- the check below holds for every row; the panel invites them again, now
-- picking the file.
UPDATE "staff_invites" SET "status" = 'cancelled', "updated_at" = now() WHERE "role" = 'teacher' AND "status" = 'pending' AND "teacher_id" IS NULL;--> statement-breakpoint
ALTER TABLE "staff_invites" ADD CONSTRAINT "staff_invites_teacher_check" CHECK (("staff_invites"."teacher_id" is null or "staff_invites"."role" = 'teacher') and ("staff_invites"."role" <> 'teacher' or "staff_invites"."status" <> 'pending' or "staff_invites"."teacher_id" is not null));--> statement-breakpoint
-- `teacher_id` enters a WHERE (the pending invite of a teacher), packages/db/CLAUDE.md.
ANALYZE "staff_invites";
