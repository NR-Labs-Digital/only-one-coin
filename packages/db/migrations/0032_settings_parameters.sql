ALTER TABLE "platform_settings" ADD COLUMN "review_window_days" integer DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE "platform_settings" ADD COLUMN "ocr_low_confidence_percent" integer DEFAULT 75 NOT NULL;--> statement-breakpoint
ALTER TABLE "platform_settings" ADD COLUMN "passing_grade" integer DEFAULT 14 NOT NULL;--> statement-breakpoint
ALTER TABLE "platform_settings" ADD COLUMN "certificate_deadline_business_days" integer DEFAULT 25 NOT NULL;--> statement-breakpoint
ALTER TABLE "platform_settings" ADD COLUMN "constancia_fee_cents" integer DEFAULT 2500 NOT NULL;--> statement-breakpoint
ALTER TABLE "platform_settings" ADD COLUMN "contract_alert_days" integer DEFAULT 45 NOT NULL;--> statement-breakpoint
ALTER TABLE "platform_settings" ADD CONSTRAINT "platform_settings_review_window_days_check" CHECK ("platform_settings"."review_window_days" between 1 and 30);--> statement-breakpoint
ALTER TABLE "platform_settings" ADD CONSTRAINT "platform_settings_ocr_low_confidence_percent_check" CHECK ("platform_settings"."ocr_low_confidence_percent" between 50 and 95);--> statement-breakpoint
ALTER TABLE "platform_settings" ADD CONSTRAINT "platform_settings_passing_grade_check" CHECK ("platform_settings"."passing_grade" between 0 and 20);--> statement-breakpoint
ALTER TABLE "platform_settings" ADD CONSTRAINT "platform_settings_certificate_deadline_business_days_check" CHECK ("platform_settings"."certificate_deadline_business_days" between 1 and 90);--> statement-breakpoint
ALTER TABLE "platform_settings" ADD CONSTRAINT "platform_settings_constancia_fee_cents_check" CHECK ("platform_settings"."constancia_fee_cents" between 100 and 100000);--> statement-breakpoint
ALTER TABLE "platform_settings" ADD CONSTRAINT "platform_settings_contract_alert_days_check" CHECK ("platform_settings"."contract_alert_days" between 1 and 180);