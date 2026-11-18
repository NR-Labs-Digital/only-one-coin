import { DEFAULT_LOCALE } from "../notification/EmailNotification.js";
import { approvedEmailsFor, rejectedEmailsFor } from "../notification/enrollmentEmails.js";
import { procedurePaymentApprovedEmails, procedurePaymentRejectedEmails } from "../notification/procedureEmails.js";
import { newPortalToken, type PortalAccessOutcome } from "../identity/portal/PortalAccess.js";
import { portalCredentialsEmail } from "../identity/portal/portalEmails.js";
import { guardianProvisioning } from "../identity/portal/guardianAccess.js";
import type { IPortalLinkBuilder, PortalAccountProvisioning } from "../identity/portal/ports.js";
import { BaseUseCase } from "../shared/base/BaseUseCase.js";
import type { SeatStatus } from "./Enrollment.js";
import type { IEnrollmentEmailContextLookup, IPaymentEmailContextLookup } from "./EnrollmentEmailContextLookup.js";
import { PaymentAlreadySettledError, PaymentNotFoundError, PaymentSeatReleasedError } from "./errors.js";
import type { IPaymentSettlementRepository, PaymentDecision, PaymentToSettle } from "./PaymentSettlement.js";
import type { EmailNotification } from "../notification/EmailNotification.js";

export interface SettlePaymentInput {
  actorId: string;
  paymentId: string;
  decision: PaymentDecision;
}

export interface SettlePaymentOutput {
  paymentId: string;
  status: "approved" | "rejected";
  /** Null for a procedure's payment: it has no seat to move. For a lot, the
   * seat of the payment's own enrollment — every other moved the same way. */
  seatStatus: SeatStatus | null;
  /** The outcome Payments has to hear about: an `email_conflict` of any
   * student of a lot if there is one, else the payment's own student's. */
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
 * A procedure's payment (OOC-83) goes through the same door and moves only its
 * request: `paid` frees the procedure's own flow to run. Whoever asked is already
 * signed in to the portal, so there is no account to create.
 *
 * A lot (OOC-158) is decided whole, as its one receipt is: approving confirms
 * every seat (one already given back refuses the lot), rejecting gives every
 * seat back, and every distinct student gets their portal account. One e-mail
 * per address, listing the address's enrollments of the lot.
 *
 * The e-mail goes out in es-PE: the enrollment does not record the language
 * its form was filled in.
 */
export class SettlePaymentUseCase extends BaseUseCase<SettlePaymentInput, SettlePaymentOutput> {
  constructor(
    private readonly settlements: IPaymentSettlementRepository,
    private readonly emailContextLookup: IEnrollmentEmailContextLookup,
    private readonly paymentEmailLookup: IPaymentEmailContextLookup,
    private readonly portalLinkBuilder: IPortalLinkBuilder,
  ) {
    super();
  }

  async run(input: SettlePaymentInput): Promise<SettlePaymentOutput> {
    const target = await this.settlements.findForSettlement(input.paymentId);
    if (!target) throw new PaymentNotFoundError();
    if (target.status === "approved" || target.status === "rejected") throw new PaymentAlreadySettledError();

    const { origin } = target;
    const approving = input.decision.kind === "approve";
    if (
      approving &&
      origin.kind === "enrollment" &&
      [origin.seatStatus, ...origin.lot.map((seat) => seat.seatStatus)].includes("released")
    ) {
      throw new PaymentSeatReleasedError();
    }

    const notifications = await this.decisionEmails(target, approving);

    // The first approval opens the portal (CLAUDE.md §1, reopened 05/10/2026):
    // the account is created with the settlement, and its e-mail carries a
    // link to set the password — never the password (outbox.vars is plain).
    // A lot opens one per distinct student, the payment's own first.
    const now = new Date();
    const portalAccess: PortalAccountProvisioning[] =
      approving && origin.kind === "enrollment"
        ? [...new Set([target.studentId, ...origin.lot.map((seat) => seat.studentId)])].map((studentId) =>
            this.provisioning(studentId, input.actorId, now),
          )
        : [];

    const to = approving ? "approved" : "rejected";
    const { seatStatus, portalAccess: outcomes } = await this.settlements.settle({
      paymentId: target.paymentId,
      origin,
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
        metadata: {
          ...(origin.kind === "enrollment"
            ? {
                enrollmentId: origin.enrollmentId,
                ...(origin.lot.length > 0 ? { lotEnrollmentIds: origin.lot.map((seat) => seat.enrollmentId) } : {}),
              }
            : { procedureRequestId: origin.procedureRequestId }),
          ...(input.decision.kind === "reject" ? { reason: input.decision.reason, note: input.decision.note } : {}),
        },
        at: now,
      },
      portalAccess,
    });

    const portalOutcome = outcomes.includes("email_conflict") ? "email_conflict" : (outcomes[0] ?? null);
    return { paymentId: target.paymentId, status: to, seatStatus, portalAccess: portalOutcome };
  }

  private provisioning(studentId: string, actorId: string, now: Date): PortalAccountProvisioning {
    const activation = newPortalToken("activation", now);
    return {
      studentId,
      actorId,
      activation,
      at: now,
      notify: (account, tokenId) => [
        portalCredentialsEmail(account, this.portalLinkBuilder.access(activation.token, DEFAULT_LOCALE), tokenId, DEFAULT_LOCALE),
      ],
      // A minor's guardian gets their own account too (OOC-147).
      guardian: guardianProvisioning(this.portalLinkBuilder, now),
    };
  }

  /** A procedure's payment speaks about the request; an enrollment's about
   * every seat it pays for — one item or a lot (`approvedEmailsFor`). */
  private async decisionEmails(target: PaymentToSettle, approving: boolean): Promise<EmailNotification[]> {
    if (target.origin.kind === "procedure") {
      const context = await this.emailContextLookup.find({ studentId: target.studentId, classGroupId: target.classGroupId });
      if (!context) return [];
      const facts = { paymentId: target.paymentId, ...context };
      return approving
        ? procedurePaymentApprovedEmails(facts, DEFAULT_LOCALE)
        : procedurePaymentRejectedEmails(facts, DEFAULT_LOCALE);
    }
    const facts = await this.paymentEmailLookup.find(target.paymentId);
    if (!facts) return [];
    return approving ? approvedEmailsFor(facts, DEFAULT_LOCALE) : rejectedEmailsFor(facts, DEFAULT_LOCALE);
  }
}
