import type { EnrollmentEmailContext } from "../enrollment/EnrollmentEmailContextLookup.js";
import type { EmailNotification, Locale } from "./EmailNotification.js";
import { enrollmentRecipients } from "./enrollmentEmails.js";

/**
 * "The module you are on is not paid yet" (OOC-86, decision of 20/11/2026):
 * sent the moment progression takes a monthly student into a module and
 * attempt nobody bought — advancing, or repeating, which is bought again.
 * Never a dunning letter: no debt, no interest, no deadline — the class is
 * simply closed until the module is bought and approved. Same people as every
 * enrollment e-mail; keyed by the enrollment, module and attempt, so entering
 * it is told once.
 */
export function monthlyModuleDueEmails(
  facts: EnrollmentEmailContext & { enrollmentId: string; module: number; attempt: number },
  locale: Locale,
): EmailNotification[] {
  const studentName = `${facts.student.firstName} ${facts.student.lastName}`;
  return enrollmentRecipients(facts).map((recipient) => ({
    templateKey: "monthly_module_due",
    to: recipient.to,
    locale,
    vars: { recipientName: recipient.name, studentName, courseName: facts.courseName, module: facts.module },
    dedupeKey: `monthly_module_due:${facts.enrollmentId}:${facts.module}:${facts.attempt}:${recipient.kind}`,
  }));
}
