import { DEFAULT_LOCALE } from "../notification/EmailNotification.js";
import { paymentApprovedEmails, paymentRejectedEmails } from "../notification/enrollmentEmails.js";
import { newPortalToken, type PortalAccessOutcome } from "../identity/portal/PortalAccess.js";
import { portalCredentialsEmail } from "../identity/portal/portalEmails.js";
import type { IPortalLinkBuilder, PortalAccountProvisioning } from "../identity/portal/ports.js";
import { BaseUseCase } from "../shared/base/BaseUseCase.js";
import type { SeatStatus } from "./Enrollment.js";
import type { IEnrollmentEmailContextLookup } from "./EnrollmentEmailContextLookup.js";
import { PaymentAlreadySettledError, PaymentNotFoundError, PaymentSeatReleasedError } from "./errors.js";
import type { IPaymentSettlementRepository, PaymentDecision } from "./PaymentSettlement.js";

export interface SettlePaymentInput {
  actorId: string;
  paymentId: string;
  decision: PaymentDecision;
}

export interface SettlePaymentOutput {
  paymentId: string;
  status: "approved" | "rejected";
  seatStatus: SeatStatus;
  portalAccess: PortalAccessOutcome | null;
}

/**
 * Where an enrollment is finished (OOC-55): a person in Payments looks at the
 * receipt and decides. Approving confirms the seat — only now is the student
 * enrolled; rejecting hands the seat back to the class group. Never automatic
 * and never from the enrollment screen: whoever opens a manual enrollment is
 * not who settles its money (CLAUDE.md §1, lock (d)).
 *
 * Approving also creates the student's portal account (first approval only —
 * later ones find it linked).
 *
 * The e-mail goes out in es-PE: the enrollment does not record the language
 * its form was filled in.
 */
export class SettlePaymentUseCase extends BaseUseCase<SettlePaymentInput, SettlePaymentOutput> {
  constructor(
    private readonly settlements: IPaymentSettlementRepository,
    private readonly emailContextLookup: IEnrollmentEmailContextLookup,
    private readonly portalLinkBuilder: IPortalLinkBuilder,
  ) {
    super();
  }

  async run(input: SettlePaymentInput): Promise<SettlePaymentOutput> {
    const target = await this.settlements.findForSettlement(input.paymentId);
    if (!target) throw new PaymentNotFoundError();
    if (target.status === "approved" || target.status === "rejected") throw new PaymentAlreadySettledError();

    const approving = input.decision.kind === "approve";
    if (approving && target.seatStatus === "released") throw new PaymentSeatReleasedError();

    const context = await this.emailContextLookup.find({
      studentId: target.studentId,
      classGroupId: target.classGroupId,
    });
    const facts = context ? { paymentId: target.paymentId, ...context } : null;
    const notifications = facts
      ? approving
        ? paymentApprovedEmails(facts, DEFAULT_LOCALE)
        : paymentRejectedEmails(facts, DEFAULT_LOCALE)
      : [];

    // The first approval opens the portal (CLAUDE.md §1, reopened 05/10/2026):
    // the account is created with the settlement, and its e-mail carries a
    // link to set the password — never the password (outbox.vars is plain).
    const now = new Date();
    const activation = newPortalToken("activation", now);
    const portalAccess: PortalAccountProvisioning | null = approving
      ? {
          studentId: target.studentId,
          actorId: input.actorId,
          activation,
          at: now,
          notify: (account, tokenId) => [
            portalCredentialsEmail(account, this.portalLinkBuilder.access(activation.token, DEFAULT_LOCALE), tokenId, DEFAULT_LOCALE),
          ],
        }
      : null;

    const to = approving ? "approved" : "rejected";
    const { seatStatus, portalAccess: portalOutcome } = await this.settlements.settle({
      paymentId: target.paymentId,
      enrollmentId: target.enrollmentId,
      classGroupId: target.classGroupId,
      to,
      decision: {
        by: input.actorId,
        at: now,
        rejectionReason: input.decision.kind === "reject" ? input.decision.reason : null,
      },
      notifications,
      audit: {
        actorId: input.actorId,
        action: approving ? "payment.approved" : "payment.rejected",
        targetId: target.paymentId,
        metadata:
          input.decision.kind === "reject"
            ? { enrollmentId: target.enrollmentId, reason: input.decision.reason, note: input.decision.note }
            : { enrollmentId: target.enrollmentId },
        at: now,
      },
      portalAccess,
    });

    return { paymentId: target.paymentId, status: to, seatStatus, portalAccess: portalOutcome };
  }
}
