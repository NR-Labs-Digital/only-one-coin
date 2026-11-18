import { Student } from "../student/Student.js";
import type { EmailNotification, LotEmailItem, Locale } from "./EmailNotification.js";

/**
 * What an enrollment e-mail needs to know, read off the records rather than
 * off a request — the enrollment path that produces it (public checkout or the
 * manual backoffice one) is irrelevant to what the e-mail says.
 */
export interface EnrollmentEmailFacts {
  enrollmentId: string;
  student: { firstName: string; lastName: string; email: string; birthDate: Date };
  guardian: { firstName: string; email: string } | null;
  courseName: string;
  classGroupStartsOn: Date;
  amountCents: number;
}

export type EnrollmentRecipientKind = "student" | "guardian";

export interface EnrollmentRecipient {
  kind: EnrollmentRecipientKind;
  to: string;
  name: string;
}

/**
 * Who hears about an enrollment. The student always does — their personal
 * Gmail is the account the course reaches them on (CLAUDE.md §1). A minor's
 * guardian hears about it too: they are the one who consented and, usually,
 * the one who paid (decision of 27/09/2026). An adult's optional guardian
 * does not.
 *
 * Only for messages about the enrollment itself — portal credentials belong
 * to the student's own account and are never copied to anybody.
 */
export function enrollmentRecipients(facts: Pick<EnrollmentEmailFacts, "student" | "guardian">): EnrollmentRecipient[] {
  const recipients: EnrollmentRecipient[] = [
    { kind: "student", to: facts.student.email, name: facts.student.firstName },
  ];

  if (facts.guardian && Student.isMinorBornOn(facts.student.birthDate)) {
    recipients.push({ kind: "guardian", to: facts.guardian.email, name: facts.guardian.firstName });
  }

  return recipients;
}

/** "We received your enrollment" — emitted by both enrollment paths in the
 * same transaction that writes the enrollment (CLAUDE.md §1, decision of
 * 27/09/2026: the manual backoffice path sends it too). */
export function enrollmentReceivedEmails(facts: EnrollmentEmailFacts, locale: Locale): EmailNotification[] {
  const studentName = `${facts.student.firstName} ${facts.student.lastName}`;

  return enrollmentRecipients(facts).map((recipient) => ({
    templateKey: "enrollment_received",
    to: recipient.to,
    locale,
    vars: {
      recipientName: recipient.name,
      studentName,
      courseName: facts.courseName,
      startsOn: facts.classGroupStartsOn.toISOString(),
      amountCents: facts.amountCents,
    },
    dedupeKey: `enrollment_received:${facts.enrollmentId}:${recipient.kind}`,
  }));
}

/** What a payment decision e-mail needs — the enrollment's people and course,
 * keyed by the payment so a second decision e-mail can never be emitted. */
export interface PaymentEmailFacts {
  paymentId: string;
  student: EnrollmentEmailFacts["student"];
  guardian: EnrollmentEmailFacts["guardian"];
  courseName: string;
  classGroupStartsOn: Date;
}

/** "We are reviewing your payment" — the receipt pipeline sent it to a person
 * (OOC-87). Keyed by the payment: it reaches review once, whichever level of
 * the ladder sent it there. */
export function paymentUnderReviewEmails(facts: PaymentEmailFacts, locale: Locale): EmailNotification[] {
  const studentName = `${facts.student.firstName} ${facts.student.lastName}`;

  return enrollmentRecipients(facts).map((recipient) => ({
    templateKey: "payment_under_review",
    to: recipient.to,
    locale,
    vars: { recipientName: recipient.name, studentName, courseName: facts.courseName },
    dedupeKey: `payment_under_review:${facts.paymentId}:${recipient.kind}`,
  }));
}

/** "Your payment was approved" — the enrollment is now real (OOC-55). */
export function paymentApprovedEmails(facts: PaymentEmailFacts, locale: Locale): EmailNotification[] {
  const studentName = `${facts.student.firstName} ${facts.student.lastName}`;

  return enrollmentRecipients(facts).map((recipient) => ({
    templateKey: "payment_approved",
    to: recipient.to,
    locale,
    vars: {
      recipientName: recipient.name,
      studentName,
      courseName: facts.courseName,
      startsOn: facts.classGroupStartsOn.toISOString(),
    },
    dedupeKey: `payment_approved:${facts.paymentId}:${recipient.kind}`,
  }));
}

/** "Your payment could not be confirmed" — the seat went back to the class group. */
export function paymentRejectedEmails(facts: PaymentEmailFacts, locale: Locale): EmailNotification[] {
  const studentName = `${facts.student.firstName} ${facts.student.lastName}`;

  return enrollmentRecipients(facts).map((recipient) => ({
    templateKey: "payment_rejected",
    to: recipient.to,
    locale,
    vars: { recipientName: recipient.name, studentName, courseName: facts.courseName },
    dedupeKey: `payment_rejected:${facts.paymentId}:${recipient.kind}`,
  }));
}

/* -------------------------------------------------------------------------- */
/* Lots (OOC-158) — one receipt, several enrollments                          */
/* -------------------------------------------------------------------------- */

/** One enrollment a payment pays for, as its e-mails need it. */
export interface PaymentItemEmailFacts {
  enrollmentId: string;
  studentId: string;
  student: EnrollmentEmailFacts["student"];
  guardian: EnrollmentEmailFacts["guardian"];
  courseName: string;
  classGroupStartsOn: Date;
}

/**
 * Everything a payment pays for, in lot order: the payment's own enrollment
 * first, then the other items of its lot. One item is the ordinary payment,
 * and its e-mails are the single-enrollment templates, unchanged.
 */
export interface PaymentCoverageEmailFacts {
  paymentId: string;
  items: PaymentItemEmailFacts[];
}

/** An address a lot e-mail goes to, and the items of the lot it hears about. */
export interface LotRecipient {
  to: string;
  name: string;
  /** The recipient kind and student of the first item that names this
   * address — what the dedupe key and the undelivered screen lead back to. */
  kind: EnrollmentRecipientKind;
  studentId: string;
  items: PaymentItemEmailFacts[];
}

/**
 * Who hears about a lot, one entry per address (decision of 16/11/2026,
 * OOC-158): each item's recipients by the single-enrollment rule
 * (`enrollmentRecipients` — the student, and a minor's guardian), merged by
 * address without case. A mother of two children gets one e-mail listing
 * both; a child with their own Gmail gets one listing their own course; the
 * same student in two courses gets one listing the two. Lot order is kept,
 * both for the addresses and for the items of each.
 */
export function lotRecipients(items: PaymentItemEmailFacts[]): LotRecipient[] {
  const byAddress = new Map<string, LotRecipient>();
  for (const item of items) {
    for (const recipient of enrollmentRecipients(item)) {
      const key = recipient.to.trim().toLowerCase();
      const existing = byAddress.get(key);
      if (existing) {
        if (!existing.items.includes(item)) existing.items.push(item);
      } else {
        byAddress.set(key, {
          to: recipient.to,
          name: recipient.name,
          kind: recipient.kind,
          studentId: item.studentId,
          items: [item],
        });
      }
    }
  }
  return [...byAddress.values()];
}

function lotItems(items: PaymentItemEmailFacts[]): LotEmailItem[] {
  return items.map((item) => ({
    studentName: `${item.student.firstName} ${item.student.lastName}`,
    courseName: item.courseName,
    startsOn: item.classGroupStartsOn.toISOString(),
  }));
}

/** `<template>:<payment>:<kind>:<student>` — the payment is the subject, and
 * the fourth part says whose file the address belongs to (OOC-90's screen
 * reads it back; `parseDeliveryDedupeKey` ignores it). */
function lotDedupeKey(template: string, paymentId: string, recipient: LotRecipient): string {
  return `${template}:${paymentId}:${recipient.kind}:${recipient.studentId}`;
}

/** "We received your enrollments" — the checkout's lot, written with it. */
export function lotEnrollmentReceivedEmails(
  facts: PaymentCoverageEmailFacts & { amountCents: number },
  locale: Locale,
): EmailNotification[] {
  return lotRecipients(facts.items).map((recipient) => ({
    templateKey: "lot_enrollment_received",
    to: recipient.to,
    locale,
    vars: { recipientName: recipient.name, items: lotItems(recipient.items), amountCents: facts.amountCents },
    dedupeKey: lotDedupeKey("lot_enrollment_received", facts.paymentId, recipient),
  }));
}

function lotDecisionEmails(
  templateKey: "lot_payment_under_review" | "lot_payment_approved" | "lot_payment_rejected",
  facts: PaymentCoverageEmailFacts,
  locale: Locale,
): EmailNotification[] {
  return lotRecipients(facts.items).map((recipient) => ({
    templateKey,
    to: recipient.to,
    locale,
    vars: { recipientName: recipient.name, items: lotItems(recipient.items) },
    dedupeKey: lotDedupeKey(templateKey, facts.paymentId, recipient),
  }));
}

function singleFacts(facts: PaymentCoverageEmailFacts): PaymentEmailFacts | null {
  const [only] = facts.items;
  return only ? { paymentId: facts.paymentId, ...only } : null;
}

/**
 * "We received your enrollment(s)" for whatever the checkout just paid for:
 * the single-enrollment template for one item, the lot one for more.
 */
export function receivedEmailsFor(
  facts: PaymentCoverageEmailFacts & { amountCents: number },
  locale: Locale,
): EmailNotification[] {
  if (facts.items.length > 1) return lotEnrollmentReceivedEmails(facts, locale);
  const [only] = facts.items;
  return only ? enrollmentReceivedEmails({ ...only, amountCents: facts.amountCents }, locale) : [];
}

/** The receipt went to a person — for a payment of one enrollment or a lot. */
export function underReviewEmailsFor(facts: PaymentCoverageEmailFacts, locale: Locale): EmailNotification[] {
  if (facts.items.length > 1) return lotDecisionEmails("lot_payment_under_review", facts, locale);
  const single = singleFacts(facts);
  return single ? paymentUnderReviewEmails(single, locale) : [];
}

/** The payment was approved — every seat it pays for is confirmed. */
export function approvedEmailsFor(facts: PaymentCoverageEmailFacts, locale: Locale): EmailNotification[] {
  if (facts.items.length > 1) return lotDecisionEmails("lot_payment_approved", facts, locale);
  const single = singleFacts(facts);
  return single ? paymentApprovedEmails(single, locale) : [];
}

/** The payment was rejected — every seat it held went back. */
export function rejectedEmailsFor(facts: PaymentCoverageEmailFacts, locale: Locale): EmailNotification[] {
  if (facts.items.length > 1) return lotDecisionEmails("lot_payment_rejected", facts, locale);
  const single = singleFacts(facts);
  return single ? paymentRejectedEmails(single, locale) : [];
}
