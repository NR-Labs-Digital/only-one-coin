CREATE TABLE "guardian_portal_links" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" text NOT NULL,
	"student_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "guardian_portal_links" ADD CONSTRAINT "guardian_portal_links_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "guardian_portal_links_user_student_uidx" ON "guardian_portal_links" USING btree ("user_id","student_id");--> statement-breakpoint
CREATE INDEX "guardian_portal_links_student_id_idx" ON "guardian_portal_links" USING btree ("student_id");--> statement-breakpoint
ALTER TABLE "guardian_portal_links" ADD CONSTRAINT "guardian_portal_links_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE restrict;
