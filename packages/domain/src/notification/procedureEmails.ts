import type { EmailNotification, EmailTemplateKey, Locale } from "./EmailNotification.js";
import { enrollmentRecipients, type PaymentEmailFacts } from "./enrollmentEmails.js";

type ProcedureTemplate = Extract<EmailTemplateKey, `procedure_payment_${string}`>;

/** Same people as the enrollment's e-mails (a minor's guardian gets a copy, and
 * is usually who paid); keyed by the payment, so a decision is told once. */
function procedureEmails(template: ProcedureTemplate, facts: PaymentEmailFacts, locale: Locale): EmailNotification[] {
  const studentName = `${facts.student.firstName} ${facts.student.lastName}`;

  return enrollmentRecipients(facts).map((recipient) => ({
    templateKey: template,
    to: recipient.to,
    locale,
    vars: { recipientName: recipient.name, studentName, courseName: facts.courseName },
    dedupeKey: `${template}:${facts.paymentId}:${recipient.kind}`,
  }));
}

export const procedurePaymentUnderReviewEmails = (facts: PaymentEmailFacts, locale: Locale) =>
  procedureEmails("procedure_payment_under_review", facts, locale);

export const procedurePaymentApprovedEmails = (facts: PaymentEmailFacts, locale: Locale) =>
  procedureEmails("procedure_payment_approved", facts, locale);

export const procedurePaymentRejectedEmails = (facts: PaymentEmailFacts, locale: Locale) =>
  procedureEmails("procedure_payment_rejected", facts, locale);
