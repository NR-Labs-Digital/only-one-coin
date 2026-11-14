import { z } from "zod";

/**
 * Where an enrollment came from (apps/api/CLAUDE.md, "Origem da matrícula").
 * A business field, not analytics: coordination answers "how many enrollments
 * did WhatsApp bring this cycle" from the enrollment rows themselves.
 *
 * - `whatsapp` — the seller's link (`?src=whatsapp`) after a sale closed
 *   outside the platform. A manual backoffice enrollment counts here too: it
 *   exists precisely for the WhatsApp sale that never reached the form.
 * - `whatsapp_ai` — the link the WhatsApp AI assistant sends (`/enrollment/wa`,
 *   OOC-139). Kept apart from the seller's so sales can tell what the bot
 *   brings in from what a person closed.
 * - `web` — anybody who arrived at the checkout on their own.
 */
export const ENROLLMENT_ORIGINS = ["web", "whatsapp", "whatsapp_ai"] as const;
export const EnrollmentOriginSchema = z.enum(ENROLLMENT_ORIGINS);
export type EnrollmentOrigin = z.infer<typeof EnrollmentOriginSchema>;

/**
 * A closed union, never free text: whatever the browser sends that is not
 * exactly one of the known channels is `web`. Nothing a visitor types into a
 * URL ends up on an enrollment row as is.
 */
export const EnrollmentOriginInputSchema = EnrollmentOriginSchema.catch("web");
