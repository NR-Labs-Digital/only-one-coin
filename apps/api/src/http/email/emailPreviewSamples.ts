import { LEGAL_IDENTITY, type EmailTemplateVars } from "@ooc/domain";

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
  course_ending_renewal: {
    recipientName: "María Fernanda",
    studentName: "María Fernanda Quispe Rojas",
    courseName: "Inglés Básico",
    endsOn: "2026-12-15T05:00:00.000Z",
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
  grade_updated: {
    recipientName: "María Fernanda",
    studentName: "María Fernanda Quispe Rojas",
    courseName: "Inglés Básico",
    grade: 15.5,
    passingGrade: 14,
  },
  grade_updated_did_not_sit: {
    recipientName: "María Fernanda",
    studentName: "María Fernanda Quispe Rojas",
    courseName: "Inglés Básico",
  },
  grade_official: {
    recipientName: "María Fernanda",
    studentName: "María Fernanda Quispe Rojas",
    courseName: "Inglés Básico",
    grade: 15.5,
    passingGrade: 14,
  },
  grade_official_did_not_sit: {
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
  // A minor filing through her mother, so every paragraph of the copy shows.
  // The supplier is the real one: it is what the sheet freezes.
  complaint_filed: {
    recipientName: "María Fernanda",
    code: "2026-000123",
    filedAt: "2026-11-24T15:30:00.000Z",
    kind: "claim",
    legalName: LEGAL_IDENTITY.legalName,
    ruc: LEGAL_IDENTITY.ruc,
    supplierAddress: LEGAL_IDENTITY.address,
    consumerName: "María Fernanda Quispe Rojas",
    nationalIdType: "DNI",
    nationalId: "71234567",
    address: "Jr. Las Begonias 456, Miraflores, Lima, Lima (frente al parque)",
    phone: "987 654 321",
    email: "maria.quispe@gmail.com",
    guardianName: "Rosa Rojas Huamán",
    guardianNationalIdType: "DNI",
    guardianNationalId: "41234567",
    goodType: "service",
    amountCents: 6990,
    purchasedOn: "2026-11-02",
    description: "Inglés Básico, paquete completo.",
    detail: "Pagué la matrícula y todavía no recibo el acceso al aula.",
    request: "Que me envíen el acceso o me indiquen cuándo empiezan las clases.",
  },
  // The answer to the sheet above, written by the team on two lines.
  complaint_answered: {
    recipientName: "María Fernanda",
    code: "2026-000123",
    filedAt: "2026-11-24T15:30:00.000Z",
    kind: "claim",
    legalName: LEGAL_IDENTITY.legalName,
    ruc: LEGAL_IDENTITY.ruc,
    answer:
      "Revisamos tu caso con la coordinación académica. El acceso a tu aula ya está habilitado en el portal.\nSi vuelves a tener un problema, escríbenos por WhatsApp.",
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
