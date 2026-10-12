import { z } from "zod";
import type { AuditLogEntry } from "../identity/ports/IAuditLogRepository.js";
import type { PortalAccessOutcome } from "../identity/portal/PortalAccess.js";
import type { PortalAccountProvisioning } from "../identity/portal/ports.js";
import type { EmailNotification } from "../notification/EmailNotification.js";
import type { SeatStatus } from "./Enrollment.js";
import type { PaymentStatus } from "./Payment.js";

export const PaymentRejectionReasonSchema = z.enum(["amount_mismatch", "illegible", "duplicate", "not_a_receipt", "other"]);
export type PaymentRejectionReason = z.infer<typeof PaymentRejectionReasonSchema>;

export type PaymentDecision = { kind: "approve" } | { kind: "reject"; reason: PaymentRejectionReason; note: string };

export interface PaymentToSettle {
  paymentId: string;
  enrollmentId: string;
  studentId: string;
  classGroupId: string;
  status: PaymentStatus;
  seatStatus: SeatStatus;
}

export interface IPaymentSettlementRepository {
  findForSettlement(paymentId: string): Promise<PaymentToSettle | null>;
  /**
   * One short transaction: the payment moves only out of `pending`/`under_review`
   * (zero rows → `PaymentAlreadySettledError`); approving confirms a reserved
   * seat and refuses a released one (`PaymentSeatReleasedError`); rejecting
   * releases a reserved seat and gives it back to the class group; a confirmed
   * seat (a monthly module) is left alone either way. Who decided, when and
   * why, the outbox and the audit entry in the same transaction. The portal account, when asked for, in the same
   * transaction.
   */
  settle(params: {
    paymentId: string;
    enrollmentId: string;
    classGroupId: string;
    to: "approved" | "rejected";
    /** Written on the payment row itself (OOC-112) — the ledger reads the
     * decision from there; `audit` stays the trail. */
    decision: { by: string; at: Date; rejectionReason: PaymentRejectionReason | null };
    notifications: EmailNotification[];
    audit: AuditLogEntry;
    /** Approving only: create the student's portal account in the same
     * transaction (spec 2026-10-05 §2). Never fails the settlement — an
     * e-mail conflict comes back as an outcome. */
    portalAccess: PortalAccountProvisioning | null;
  }): Promise<{ seatStatus: SeatStatus; portalAccess: PortalAccessOutcome | null }>;
}
