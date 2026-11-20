import type { PaymentMethod } from "../enrollment/Payment.js";

export interface SubmitMonthlyPaymentParams {
  enrollmentId: string;
  receiptUploadId: string;
  /** The account that uploaded the receipt — the session's. */
  userId: string;
  method: PaymentMethod;
  operationNumber: string;
  /** How many of the modules for sale, from the first: always a prefix. */
  moduleCount: number;
  idempotencyKey: string;
}

/** The modules a payment bought and what it charged. */
export interface MonthlyPaymentSubmitted {
  paymentId: string;
  amountCents: number;
  modules: { module: number; attempt: number }[];
}

export interface IMonthlyPaymentRepository {
  /**
   * The enrollment, if it hangs off a file this account reaches, its plan is
   * monthly, it is not retired and its seat is confirmed — the first purchase
   * already went through Payments.
   */
  findOwnEnrollment(params: { userId: string; enrollmentId: string }): Promise<{ enrollmentId: string; studentId: string } | null>;

  /**
   * One transaction, with the enrollment locked: what is for sale is read
   * again (`purchasableModules`) and the selection must be its first
   * `moduleCount` items (else `MonthlyModulesNotForSaleError`); the amount is
   * that many times the plan's price in force today, never one from the
   * client; the receipt is this account's, uploaded and unlinked (else
   * `ReceiptNotReadyError`); the operation number unused. Then the payment
   * (`pending`), one module row per item, the receipt linked and the audit
   * entry. A retry with the same key returns the first payment.
   */
  submitPayment(params: SubmitMonthlyPaymentParams): Promise<MonthlyPaymentSubmitted>;
}
