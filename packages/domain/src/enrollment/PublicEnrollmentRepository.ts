import type { EmailNotification } from "../notification/EmailNotification.js";
import type { Guardian } from "../student/Guardian.js";
import type { Student } from "../student/Student.js";
import type { Enrollment } from "./Enrollment.js";
import type { Payment } from "./Payment.js";

/**
 * What the public checkout needs to know about a class group + plan before
 * it lets somebody commit to it: the course's minimum age (CLAUDE.md §1)
 * and the plan price in force. A narrower read than the backoffice's
 * `ListOpenClassGroupsQuery` — this only ever validates one pair the client
 * already chose, never lists anything.
 */
export interface PublicEnrollmentContext {
  courseId: string;
  courseMinAge: number;
  planPriceId: string;
  amountCents: number;
  /** Carried for the "enrollment received" e-mail, not for any check. */
  courseName: string;
  classGroupStartsOn: Date;
}

/** One person of the checkout (OOC-158: a lot may carry several). */
export interface PublicEnrollmentPersonToWrite {
  /** Who the form says this is — a proposal; the document decides who it is
   * (see the interface below). */
  student: Student;
  guardian: Guardian | null;
}

/** One enrollment of the checkout: a seat hold, the person it is for, and the
 * enrollment to write. */
export interface PublicEnrollmentItemToWrite {
  /** Consumed in the same transaction: still `active` (or `expired`, which
   * is seated again — OOC-155) and for the enrollment's class group, or the
   * submit fails with `SeatHoldExpiredError` and writes nothing. */
  seatHoldId: string;
  /** Index into `people`. */
  person: number;
  enrollment: Enrollment;
}

export interface SubmitPublicEnrollmentParams {
  people: PublicEnrollmentPersonToWrite[];
  /** Every enrollment the payment pays for, in lot order. The first is the
   * payment's own (`payment.enrollmentId`); the others, when there are any,
   * are the lot's (OOC-158, `payment_lot_enrollments`). */
  items: PublicEnrollmentItemToWrite[];
  /** Appended for every person with a guardian — the guardian is who accepts,
   * timestamped and IP'd server-side (CLAUDE.md §8), never client-supplied. */
  consent: { version: string; acceptedAt: Date; ip: string } | null;
  payment: Payment;
  /** The receipt the checkout uploaded before submit — must belong to the
   * first item's seat hold and be at least `uploaded` (OOC-19), or the submit
   * fails with `ReceiptNotReadyError` and writes nothing. Linked to the new
   * payment in the same transaction. */
  receiptUploadId: string;
  /** Written to the outbox in the same transaction. An idempotent retry
   * writes nothing: the first attempt already did. */
  notifications: EmailNotification[];
}

export interface SubmitPublicEnrollmentResult {
  /** The resolved people, in the order of `params.people`. */
  students: Student[];
  /** In the order of `params.items`. */
  enrollments: Enrollment[];
  payment: Payment;
}

/**
 * One atomic unit, same reasoning as `IEnrollmentRepository`: student,
 * guardian, consent, consuming the seat hold, the enrollment and the payment
 * all succeed together or none of them do — a self-enrollment can never leave
 * a student row behind with no seat to show for it.
 *
 * A lot (OOC-158) is the same unit with several items: every person, every
 * seat and the one payment that pays for all of them commit together — a
 * refused item leaves nothing of the others behind. The holds are locked in a
 * fixed order (by id), so two submits sharing a hold cannot deadlock.
 *
 * The seat itself was already taken when the hold was claimed
 * (`ISeatHoldRepository.claim`); the submit passes it to the enrollment and
 * never touches `seats_taken` again.
 *
 * Idempotency (CLAUDE.md §5) is handled by checking `payment.idempotencyKey`
 * first, inside the same transaction: a retry with the same key returns the
 * row the first attempt already created instead of consuming anything.
 *
 * Identity resolution belongs to the same transaction, for the same reason:
 * `params.student` is who the form says is enrolling, not necessarily a new
 * person. If that document is already on file, `submit` enrolls the record
 * that exists and refreshes the contact details the person just retyped —
 * CLAUDE.md §1 is explicit that a returning student comes back to their own
 * record, "nunca duplicando `student`". Deciding that outside the transaction
 * would be deciding it against a read that two concurrent submits can both
 * win; the id `params.student` carries is therefore a proposal, and the
 * result's `student.id` is the answer — the seat, the guardian and the
 * enrollment all follow the resolved person, never the proposed one.
 */
export interface IPublicEnrollmentRepository {
  findContext(params: { classGroupId: string; planId: string }): Promise<PublicEnrollmentContext | null>;

  submit(params: SubmitPublicEnrollmentParams): Promise<SubmitPublicEnrollmentResult>;
}
