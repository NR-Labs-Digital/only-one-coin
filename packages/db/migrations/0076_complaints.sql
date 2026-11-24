CREATE SEQUENCE "public"."complaint_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "complaints" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"code" text NOT NULL,
	"kind" text NOT NULL,
	"supplier_legal_name" text NOT NULL,
	"supplier_ruc" text NOT NULL,
	"supplier_address" text NOT NULL,
	"consumer_first_name" text NOT NULL,
	"consumer_last_name" text NOT NULL,
	"consumer_second_last_name" text,
	"consumer_national_id_type" text NOT NULL,
	"consumer_national_id" text NOT NULL,
	"consumer_phone" text NOT NULL,
	"consumer_email" text NOT NULL,
	"consumer_department" text NOT NULL,
	"consumer_province" text NOT NULL,
	"consumer_district" text NOT NULL,
	"consumer_address" text NOT NULL,
	"consumer_address_reference" text,
	"consumer_is_minor" boolean NOT NULL,
	"guardian_first_name" text,
	"guardian_last_name" text,
	"guardian_national_id_type" text,
	"guardian_national_id" text,
	"good_type" text NOT NULL,
	"amount_cents" integer,
	"purchased_on" date,
	"description" text NOT NULL,
	"detail" text NOT NULL,
	"request" text NOT NULL,
	"privacy_notice_version" text NOT NULL,
	"consumer_ip" text NOT NULL,
	"locale" text NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "complaints_kind_check" CHECK ("complaints"."kind" in ('claim', 'grievance')),
	CONSTRAINT "complaints_good_type_check" CHECK ("complaints"."good_type" in ('product', 'service')),
	CONSTRAINT "complaints_amount_check" CHECK ("complaints"."amount_cents" is null or "complaints"."amount_cents" >= 0),
	CONSTRAINT "complaints_national_id_type_check" CHECK ("complaints"."consumer_national_id_type" in ('DNI', 'CE', 'passport') and ("complaints"."guardian_national_id_type" is null or "complaints"."guardian_national_id_type" in ('DNI', 'CE', 'passport'))),
	CONSTRAINT "complaints_locale_check" CHECK ("complaints"."locale" in ('es-PE', 'pt-BR', 'en')),
	CONSTRAINT "complaints_guardian_check" CHECK ("complaints"."consumer_is_minor" = ("complaints"."guardian_first_name" is not null) and num_nonnulls("complaints"."guardian_first_name", "complaints"."guardian_last_name", "complaints"."guardian_national_id_type", "complaints"."guardian_national_id") in (0, 4))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "complaints_code_uidx" ON "complaints" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "complaints_idempotency_key_uidx" ON "complaints" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "complaints_created_at_idx" ON "complaints" USING btree ("created_at");--> statement-breakpoint
-- The repository draws the sheet's number with nextval; the default privileges
-- of 0011 would already cover it, written out as in 0039.
GRANT USAGE, SELECT ON SEQUENCE complaint_number_seq TO ooc_app;
--> statement-breakpoint
-- A sheet of the complaints book is a legal record (OOC-63): never rewritten,
-- never removed. The company's answer will be a row of its own (OOC-58).
-- Both layers, never one (packages/db/CLAUDE.md).
REVOKE UPDATE, DELETE ON complaints FROM ooc_app;
--> statement-breakpoint
DROP TRIGGER IF EXISTS complaints_append_only ON complaints;
--> statement-breakpoint
CREATE TRIGGER complaints_append_only
	BEFORE UPDATE OR DELETE OR TRUNCATE ON complaints
	FOR EACH STATEMENT EXECUTE FUNCTION forbid_history_rewrite();
