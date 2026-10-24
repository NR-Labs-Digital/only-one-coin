-- OOC-124: a contract is recorded as its period and the template version it
-- was generated from; the signed copy is kept outside the platform. The file
-- columns stop being required — rows filed under OOC-81 keep theirs — and two
-- CHECKs keep a row whole: the file comes as three columns or none, and every
-- row has a file or a template version. Relaxing NOT NULL and adding a column
-- is additive; the append-only lock (0025) is untouched. The new column is not
-- in any WHERE, so no ANALYZE. The FK is named by hand — the generated name
-- runs past Postgres' 63 characters.
ALTER TABLE "teacher_contracts" ALTER COLUMN "object_key" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "teacher_contracts" ALTER COLUMN "file_name" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "teacher_contracts" ALTER COLUMN "file_size_bytes" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "teacher_contracts" ADD COLUMN "template_version_id" uuid;--> statement-breakpoint
ALTER TABLE "teacher_contracts" ADD CONSTRAINT "teacher_contracts_template_version_id_fk" FOREIGN KEY ("template_version_id") REFERENCES "public"."document_template_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teacher_contracts" ADD CONSTRAINT "teacher_contracts_file_check" CHECK (("teacher_contracts"."object_key" is null) = ("teacher_contracts"."file_name" is null) and ("teacher_contracts"."object_key" is null) = ("teacher_contracts"."file_size_bytes" is null));--> statement-breakpoint
ALTER TABLE "teacher_contracts" ADD CONSTRAINT "teacher_contracts_source_check" CHECK ("teacher_contracts"."object_key" is not null or "teacher_contracts"."template_version_id" is not null);