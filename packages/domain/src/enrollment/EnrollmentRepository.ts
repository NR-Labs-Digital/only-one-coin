import type { EmailNotification } from "../notification/EmailNotification.js";
import type { Enrollment } from "./Enrollment.js";
import type { Payment } from "./Payment.js";

/**
 * One method, not `create()` + a separate payment insert: the seat
 * increment on class_groups, the enrollment row and the payment row are one
 * atomic unit from the business's perspective (CLAUDE.md §5) — an
 * enrollment can never exist without its payment, and the seat can never be
 * claimed without both. The transaction boundary is an infra concern; the
 * port only names the operation.
 *
 * Throws ClassGroupFullError (see errors.ts) when the atomic seat increment
 * finds no room — never validated ahead of time in application code
 * (CLAUDE.md §5, "nunca validar vaga na aplicação").
 *
 * `notifications` land in the outbox inside the same transaction — the
 * e-mail about an enrollment exists exactly when the enrollment does.
 *
 * `receipt` is the confirmed upload the payment is born with (OOC-146): it
 * must belong to `uploadedBy`, be confirmed and not yet attached to any
 * payment, or the whole write is refused with ReceiptNotReadyError — locked
 * in the same transaction, so one file never pays for two enrollments.
 *
 * The same transaction also closes the student's active waitlist entry for
 * that class group, if there is one (left_reason 'enrolled', OOC-35) — the
 * queue never shows somebody who already holds the seat.
 */
export interface IEnrollmentRepository {
  createWithPayment(params: {
    enrollment: Enrollment;
    payment: Payment;
    notifications: EmailNotification[];
    receipt: { receiptUploadId: string; uploadedBy: string };
  }): Promise<{
    enrollment: Enrollment;
    payment: Payment;
  }>;
}
