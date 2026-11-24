-- OOC-103: a teacher file may be registered without the profile (document,
-- phone, origin, address), for the teacher to fill in at onboarding. The
-- profile is all-or-nothing; the region stays optional, as before.
ALTER TABLE "teachers" ALTER COLUMN "national_id_type" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "teachers" ALTER COLUMN "national_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "teachers" ALTER COLUMN "phone" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "teachers" ALTER COLUMN "nationality" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "teachers" ALTER COLUMN "country" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "teachers" ALTER COLUMN "city" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "teachers" ALTER COLUMN "address_line" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "teachers" ADD CONSTRAINT "teachers_profile_check" CHECK (num_nulls("teachers"."national_id_type", "teachers"."national_id", "teachers"."phone", "teachers"."nationality", "teachers"."country", "teachers"."city", "teachers"."address_line") = 0 or (num_nulls("teachers"."national_id_type", "teachers"."national_id", "teachers"."phone", "teachers"."nationality", "teachers"."country", "teachers"."city", "teachers"."address_line") = 7 and "teachers"."region" is null));