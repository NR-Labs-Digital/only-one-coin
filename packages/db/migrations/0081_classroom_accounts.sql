CREATE TABLE "classroom_accounts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"email" text NOT NULL,
	"password_ciphertext" text NOT NULL,
	"password_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"released_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "platform_settings" ADD COLUMN "classroom_account_max_teachers" integer DEFAULT 7 NOT NULL;--> statement-breakpoint
ALTER TABLE "teachers" ADD COLUMN "classroom_account_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "classroom_accounts_email_live_uidx" ON "classroom_accounts" USING btree (lower("email")) WHERE "classroom_accounts"."deleted_at" is null;--> statement-breakpoint
ALTER TABLE "teachers" ADD CONSTRAINT "teachers_classroom_account_id_classroom_accounts_id_fk" FOREIGN KEY ("classroom_account_id") REFERENCES "public"."classroom_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "teachers_classroom_account_id_idx" ON "teachers" USING btree ("classroom_account_id");--> statement-breakpoint
ALTER TABLE "platform_settings" ADD CONSTRAINT "platform_settings_classroom_account_max_teachers_check" CHECK ("platform_settings"."classroom_account_max_teachers" between 1 and 50);--> statement-breakpoint
ANALYZE "teachers";