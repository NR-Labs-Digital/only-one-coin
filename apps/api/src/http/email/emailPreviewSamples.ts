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
/** A mother's two children in one lot (OOC-158). */
const LOT_SAMPLE_ITEMS = [
  { studentName: "María Fernanda Quispe Rojas", courseName: "Inglés Básico", startsOn: "2026-11-09T05:00:00.000Z" },
  { studentName: "Diego Quispe Rojas", courseName: "Inglés Kids", startsOn: "2026-11-16T05:00:00.000Z" },
];

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
  lot_enrollment_received: { recipientName: "Rosa", items: LOT_SAMPLE_ITEMS, amountCents: 13980 },
  lot_payment_under_review: { recipientName: "Rosa", items: LOT_SAMPLE_ITEMS },
  lot_payment_approved: { recipientName: "Rosa", items: LOT_SAMPLE_ITEMS },
  lot_payment_rejected: { recipientName: "Rosa", items: LOT_SAMPLE_ITEMS },
  procedure_payment_under_review: {
    recipientName: "María Fernanda",
    studentName: "María Fernanda Quispe Rojas",
    courseName: "Inglés Básico",
  },
  procedure_payment_approved: {
    recipientName: "María Fernanda",
    studentName: "María Fernanda Quispe Rojas",
    courseName: "Inglés Básico",
  },
  procedure_payment_rejected: {
    recipientName: "María Fernanda",
    studentName: "María Fernanda Quispe Rojas",
    courseName: "Inglés Básico",
  },
  monthly_payment_under_review: {
    recipientName: "María Fernanda",
    studentName: "María Fernanda Quispe Rojas",
    courseName: "Inglés Básico",
    modules: "2, 3",
  },
  monthly_payment_approved: {
    recipientName: "María Fernanda",
    studentName: "María Fernanda Quispe Rojas",
    courseName: "Inglés Básico",
    modules: "2, 3",
  },
  monthly_payment_rejected: {
    recipientName: "María Fernanda",
    studentName: "María Fernanda Quispe Rojas",
    courseName: "Inglés Básico",
    modules: "2, 3",
  },
  monthly_module_due: {
    recipientName: "María Fernanda",
    studentName: "María Fernanda Quispe Rojas",
    courseName: "Inglés Básico",
    module: 2,
  },
  enrollment_freeze_reengagement: {
    recipientName: "María Fernanda",
    studentName: "María Fernanda Quispe Rojas",
    courseName: "Inglés Básico",
    months: 3,
  },
  grade_posted: {
    recipientName: "María Fernanda",
    studentName: "María Fernanda Quispe Rojas",
    courseName: "Inglés Básico",
    grade: 16.5,
    passingGrade: 14,
  },
  grade_did_not_sit: {
    recipientName: "María Fernanda",
    studentName: "María Fernanda Quispe Rojas",
    courseName: "Inglés Básico",
  },
  grade_corrected: {
    recipientName: "María Fernanda",
    studentName: "María Fernanda Quispe Rojas",
    courseName: "Inglés Básico",
    grade: 15,
    passingGrade: 14,
  },
  grade_corrected_did_not_sit: {
    recipientName: "María Fernanda",
    studentName: "María Fernanda Quispe Rojas",
    courseName: "Inglés Básico",
  },
  enrollment_certificate_issued: {
    recipientName: "María Fernanda",
    studentName: "María Fernanda Quispe Rojas",
    courseName: "Inglés Básico",
    code: "OOC-7K4M-9QX2",
  },
  certificate_issued: {
    recipientName: "María Fernanda",
    studentName: "María Fernanda Quispe Rojas",
    courseName: "Inglés Básico",
    code: "OOC-7K4M-9QX2",
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
  staff_invite: {
    recipientName: "Lucía Ramírez",
    accessUrl: "https://example.com/backoffice/invite/sample",
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
