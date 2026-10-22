import type { PaymentMethod } from "./Payment.js";
import type { ReceiptExtraction, ReceiptExtractionFailureReason } from "./ReceiptExtraction.js";
import type { ReceiptValidationDetail } from "./ReceiptValidationRepository.js";
import type { ReceiptVerdictOutcome } from "./ReceiptValidation.js";

/** A re-read waiting for the model: the receipt to read and what its verdict
 * is checked against — the same facts the first validation used. */
export interface ReceiptRereadSubject {
  rereadId: string;
  receiptUploadId: string;
  paymentId: string;
  tier: number;
  processedObjectKey: string;
  /** `payments.amount_cents` — the price frozen at enrollment. */
  expectedCents: number;
  declaredOperationNumber: string | null;
  declaredMethod: PaymentMethod;
}

/** What the worker hands back: the reading, or why there is none. */
export type ReceiptRereadResult =
  | { kind: "read"; extraction: ReceiptExtraction }
  | { kind: "failed"; modelName: string; reason: ReceiptExtractionFailureReason };

/**
 * The re-read's view of `receipt_rereads` (ROADMAP Sessão 32). A request is a
 * row; the worker fills it once. Nothing here touches `payments.status`: a
 * re-read informs the person who settles, it never routes the payment (owner,
 * 22/10/2026).
 */
export interface IReceiptRereadRepository {
  /**
   * One transaction: checks the payment is still open and its latest upload
   * is processed, inserts the request and writes `payment.receipt_reread_requested`
   * to the audit log. Throws `PaymentNotFoundError`,
   * `PaymentAlreadySettledError`, `ReceiptNotRereadableError` or
   * `ReceiptRereadInProgressError` (one pending request per receipt).
   */
  request(params: { paymentId: string; actorId: string; tier: number }): Promise<{ rereadId: string; receiptUploadId: string }>;

  /** `null` when the request is unknown or already answered. */
  findPending(rereadId: string): Promise<ReceiptRereadSubject | null>;

  /** Stamps the reading and its verdict together, once (`read_at is null`).
   * `false` when another delivery got there first. */
  record(params: {
    subject: ReceiptRereadSubject;
    result: ReceiptRereadResult;
    outcome: ReceiptVerdictOutcome;
    detail: ReceiptValidationDetail;
  }): Promise<boolean>;
}
