import type { EmailNotification } from "../notification/EmailNotification.js";
import type { PaymentMethod, PaymentStatus } from "./Payment.js";
import type { ReceiptValidationSettings, ReceiptVerdictOutcome, ReceiptVerdictReason } from "./ReceiptValidation.js";

/** A receipt ready for the traffic light: screened (level 0) and read at
 * level 1 — the reading may be a failure — and not validated yet. */
export interface ReceiptValidationSubject {
  receiptUploadId: string;
  paymentId: string;
  /** The enrollment's, for who to write to if the payment goes to review. */
  studentId: string;
  classGroupId: string;
  paymentStatus: PaymentStatus;
  /** `payments.amount_cents` — the price frozen at enrollment, never today's. */
  expectedCents: number;
  /** What the person typed at checkout. */
  declaredOperationNumber: string | null;
  /** `null` when the reading failed or found no amount. */
  readAmountCents: number | null;
  readOperationNumber: string | null;
  /** `payments.method` — what the person declared at checkout. */
  declaredMethod: PaymentMethod;
  /** `null` when the reading failed or found no usable method. */
  readMethod: PaymentMethod | null;
}

/** Stored with the verdict (`receipt_uploads.validation_detail`): what it was
 * decided with, so a later settings change never makes it unexplainable. */
export interface ReceiptValidationDetail extends ReceiptValidationSettings {
  reason: ReceiptVerdictReason;
  expectedCents: number;
  readCents: number | null;
}

/** What recording the verdict did to the payment. Never an approval: the
 * traffic light only validates, a person approves (owner, 03/10/2026). */
export type ReceiptValidationEffect =
  /** Not green, latest upload, payment was `pending`: moved to
   * `under_review`. */
  | "routed_to_review"
  /** Verdict recorded and the payment left as it was: green (it stays
   * `pending`, waiting for a person), or the payment was not `pending`, or
   * this is not its latest upload. */
  | "none"
  /** Another delivery already recorded a verdict — nothing written. */
  | "already_validated";

export interface IReceiptValidationRepository {
  /** `null` when the upload is unknown, not attached to a payment, not
   * screened, has no level-1 row, or is already validated. */
  findSubject(receiptUploadId: string): Promise<ReceiptValidationSubject | null>;

  /**
   * One transaction: stamps the verdict once (`validated_at is null`), then
   * — only for the payment's latest upload, only while the payment is still
   * `pending`, and only when the verdict is not green — moves the payment to
   * `under_review`, writing `notifications` (the `payment_under_review`
   * e-mail) to the outbox in the same transaction — and only then. It never
   * approves, never rejects, never touches the seat.
   */
  record(params: {
    subject: ReceiptValidationSubject;
    outcome: ReceiptVerdictOutcome;
    detail: ReceiptValidationDetail;
    notifications: EmailNotification[];
  }): Promise<ReceiptValidationEffect>;
}
