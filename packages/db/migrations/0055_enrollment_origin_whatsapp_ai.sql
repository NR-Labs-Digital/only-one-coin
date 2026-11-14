-- OOC-139: the WhatsApp AI assistant's link gets its own channel, apart from the
-- seller's. Widens both CHECKs; no row changes.
ALTER TABLE "enrollments" DROP CONSTRAINT "enrollments_origin_check";--> statement-breakpoint
ALTER TABLE "seat_holds" DROP CONSTRAINT "seat_holds_origin_check";--> statement-breakpoint
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_origin_check" CHECK ("origin" in ('whatsapp', 'whatsapp_ai', 'web'));--> statement-breakpoint
ALTER TABLE "seat_holds" ADD CONSTRAINT "seat_holds_origin_check" CHECK ("seat_holds"."origin" in ('whatsapp', 'whatsapp_ai', 'web'));