import type { IssuedDocumentKind } from "../issuedDocument/IssuedDocument.js";
import type { EmailNotification, Locale } from "./EmailNotification.js";
import { enrollmentRecipients, type EnrollmentEmailFacts } from "./enrollmentEmails.js";

/** What an issued document's e-mail needs: the document and the seat's people. */
export interface IssuedDocumentEmailFacts {
  documentId: string;
  kind: IssuedDocumentKind;
  code: string;
  student: EnrollmentEmailFacts["student"];
  guardian: EnrollmentEmailFacts["guardian"];
  courseName: string;
}

const TEMPLATE = {
  enrollment_certificate: "enrollment_certificate_issued",
  certificate: "certificate_issued",
} as const satisfies Record<IssuedDocumentKind, string>;

/**
 * "Your document is ready" (OOC-33) — the consequence of issuing, never a
 * button of its own (docs/DOCUMENTOS-E-CERTIFICADOS.md §4). Written to the
 * outbox in the same transaction as the document. The student hears, and a
 * minor's guardian too, as with every enrollment e-mail. Keyed by document,
 * so reprocessing never sends twice.
 */
export function issuedDocumentEmails(facts: IssuedDocumentEmailFacts, locale: Locale): EmailNotification[] {
  const studentName = `${facts.student.firstName} ${facts.student.lastName}`;
  const templateKey = TEMPLATE[facts.kind];
  return enrollmentRecipients(facts).map((recipient) => ({
    templateKey,
    to: recipient.to,
    locale,
    vars: { recipientName: recipient.name, studentName, courseName: facts.courseName, code: facts.code },
    dedupeKey: `${templateKey}:${facts.documentId}:${recipient.kind}`,
  }));
}
