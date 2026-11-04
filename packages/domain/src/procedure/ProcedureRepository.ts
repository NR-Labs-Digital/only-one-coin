import type { AuditLogEntry } from "../identity/ports/IAuditLogRepository.js";
import type { PaymentMethod } from "../enrollment/Payment.js";
import type { ProcedureKind, ProcedurePrice, ProcedureRequestRef } from "./Procedure.js";

export interface SubmitProcedurePaymentParams {
  requestId: string;
  receiptUploadId: string;
  method: PaymentMethod;
  operationNumber: string;
  idempotencyKey: string;
  actorId: string;
}

export interface IProcedureRepository {
  /** The enrollment, if it hangs off a file of this account, is not retired
   * and its seat is confirmed — the eligibility rule of the constancia. */
  findEligibleEnrollment(params: { userId: string; enrollmentId: string }): Promise<{ studentId: string } | null>;

  /** The request, if it hangs off a file of this account. */
  findOwnRequest(params: { userId: string; requestId: string }): Promise<ProcedureRequestRef | null>;

  /**
   * The live request of this enrollment and kind, or a new one frozen at the
   * price in force, with its audit entry, in one transaction. The partial
   * unique index decides a race; `null` when the kind has no price.
   */
  open(params: { kind: ProcedureKind; studentId: string; enrollmentId: string; actorId: string }): Promise<ProcedureRequestRef | null>;

  /**
   * One transaction: the request locked and still payable (else
   * `ProcedureNotPayableError`), the receipt its own and uploaded (else
   * `ReceiptNotReadyError`), the operation number unused
   * (`OperationNumberAlreadyUsedError`), and then the payment — always for the
   * frozen amount, never one from the client — with the receipt linked and the
   * audit entry. A retry with the same key returns the first payment.
   */
  submitPayment(params: SubmitProcedurePaymentParams): Promise<{ paymentId: string }>;

  currentPrices(): Promise<ProcedurePrice[]>;

  /** Append-only: a new price is a new row, with its audit entry. */
  addPrice(params: { kind: ProcedureKind; amountCents: number; actorId: string; audit: Omit<AuditLogEntry, "targetId"> }): Promise<ProcedurePrice>;
}
