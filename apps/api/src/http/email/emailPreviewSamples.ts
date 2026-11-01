import type { EmailTemplateVars } from "@ooc/domain";

/**
 * What the backoffice preview renders each template over (OOC-88). Invented on
 * purpose: the preview is there to check the wording, and rendering it over a
 * real student would put their name on a screen with no reason to hold it
 * (CLAUDE.md §8). Typed by `EmailTemplateVars`, so a template that starts
 * being emitted without a sample here fails to compile.
 *
 * Links point at `example.com`: the preview is drawn in a sandboxed frame, and
 * a sample button that opened a real portal page would be a link to nowhere
 * with the platform's name on it.
 */
export const EMAIL_PREVIEW_SAMPLES: EmailTemplateVars = {
  enrollment_received: {
    recipientName: "María Fernanda",
    studentName: "María Fernanda Quispe Rojas",
    courseName: "Inglés Básico",
    startsOn: "2026-11-09T05:00:00.000Z",
    amountCents: 6990,
  },
  payment_under_review: {
    recipientName: "María Fernanda",
    studentName: "María Fernanda Quispe Rojas",
    courseName: "Inglés Básico",
  },
  payment_approved: {
    recipientName: "María Fernanda",
    studentName: "María Fernanda Quispe Rojas",
    courseName: "Inglés Básico",
    startsOn: "2026-11-09T05:00:00.000Z",
  },
  payment_rejected: {
    recipientName: "María Fernanda",
    studentName: "María Fernanda Quispe Rojas",
    courseName: "Inglés Básico",
  },
  portal_credentials: {
    recipientName: "María Fernanda",
    loginEmail: "maria.quispe@gmail.com",
    accessUrl: "https://example.com/access/sample",
  },
  portal_password_reset: {
    recipientName: "María Fernanda",
    resetUrl: "https://example.com/access/sample",
  },
  staff_password_reset: {
    recipientName: "Lucía Ramírez",
    resetUrl: "https://example.com/backoffice/reset-password/sample",
  },
  email_verification_code: { recipientName: "María Fernanda", code: "123456" },
  staff_mfa_code: { recipientName: "Lucía Ramírez", code: "123456" },
};

/** Who the preview says it is going to — invented, like the names above. */
export const EMAIL_PREVIEW_RECIPIENTS = {
  student: "maria.quispe@gmail.com",
  staff: "lucia.ramirez@example.com",
} as const;
