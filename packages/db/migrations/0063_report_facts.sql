CREATE TABLE "report_class_group_facts" (
	"class_group_id" uuid PRIMARY KEY NOT NULL,
	"seats_taken" integer NOT NULL,
	"capacity" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_month_facts" (
	"class_group_module_id" uuid NOT NULL,
	"month" date NOT NULL,
	"enrollments" integer NOT NULL,
	"collected_cents" bigint NOT NULL,
	CONSTRAINT "report_month_facts_class_group_module_id_month_pk" PRIMARY KEY("class_group_module_id","month")
);
--> statement-breakpoint
CREATE TABLE "report_refreshes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"refreshed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"duration_ms" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_run_facts" (
	"class_group_module_id" uuid PRIMARY KEY NOT NULL,
	"enrollments" integer NOT NULL,
	"reserved" integer NOT NULL,
	"collected_cents" bigint NOT NULL,
	"pending_cents" bigint NOT NULL,
	"pending_count" integer NOT NULL,
	"low_grades" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "report_class_group_facts" ADD CONSTRAINT "report_class_group_facts_class_group_id_class_groups_id_fk" FOREIGN KEY ("class_group_id") REFERENCES "public"."class_groups"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_month_facts" ADD CONSTRAINT "report_month_facts_class_group_module_id_class_group_modules_id_fk" FOREIGN KEY ("class_group_module_id") REFERENCES "public"."class_group_modules"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_run_facts" ADD CONSTRAINT "report_run_facts_class_group_module_id_class_group_modules_id_fk" FOREIGN KEY ("class_group_module_id") REFERENCES "public"."class_group_modules"("id") ON DELETE restrict ON UPDATE no action;