import { DEFAULT_LOCALE } from "../notification/EmailNotification.js";
import { enrollmentReceivedEmails } from "../notification/enrollmentEmails.js";
import type { IAuditLogRepository } from "../identity/ports/IAuditLogRepository.js";
import { BaseUseCase } from "../shared/base/BaseUseCase.js";
import { Enrollment } from "./Enrollment.js";
import type { IEnrollmentEmailContextLookup } from "./EnrollmentEmailContextLookup.js";
import type { IEnrollmentRepository } from "./EnrollmentRepository.js";
import { Payment, type PaymentMethod } from "./Payment.js";
import { PlanPriceNotFoundError } from "./errors.js";
import type { IPlanPriceLookup } from "./PlanPriceLookup.js";

export interface CreateManualEnrollmentInput {
  /** Who opened the enrollment — the student file's activity names them (OOC-75). */
  actorId: string;
  studentId: string;
  classGroupId: string;
  planId: string;
  method: PaymentMethod;
  methodDetail: string | null;
  operationNumber: string;
  /** The receipt this same account uploaded and confirmed — mandatory since
   * OOC-146: the manual enrollment's receipt goes up the same OCR ladder as
   * the checkout's, never as a box ticked by hand. */
  receiptUploadId: string;
}

export interface CreateManualEnrollmentOutput {
  enrollment: Enrollment;
  payment: Payment;
}

/**
 * The manual backoffice exception (CLAUDE.md §1): staff opens an enrollment
 * over a student already on file, for a sale that closed on WhatsApp and
 * never reached the public form. Four locks, all enforced here:
 * (a) studentId must already exist — enforced by the FK, this usecase never
 *     creates a student; (b) the price is resolved server-side from the
 *     plan in force, never accepted from the client; (c) the seat is always
 *     reserved, never confirmed (Enrollment.createManual); (d) the payment
 *     never starts approved (Payment.createManual), and is born with a real
 *     receipt that goes up the same OCR ladder and review queue (OOC-146).
 *
 * The student hears about it exactly as a checkout student would — the same
 * "enrollment received" e-mail (decision of 27/09/2026). In es-PE: the
 * student never chose a language here, and the staff member's is not theirs.
 */
export class CreateManualEnrollmentUseCase extends BaseUseCase<
  CreateManualEnrollmentInput,
  CreateManualEnrollmentOutput
> {
  constructor(
    private readonly enrollmentRepository: IEnrollmentRepository,
    private readonly planPriceLookup: IPlanPriceLookup,
    private readonly emailContextLookup: IEnrollmentEmailContextLookup,
    private readonly auditLog: IAuditLogRepository,
  ) {
    super();
  }

  async run(input: CreateManualEnrollmentInput): Promise<CreateManualEnrollmentOutput> {
    const price = await this.planPriceLookup.findCurrentPrice(input.planId);

    if (!price) {
      throw new PlanPriceNotFoundError();
    }

    const enrollment = Enrollment.createManual({
      studentId: input.studentId,
      classGroupId: input.classGroupId,
      planPriceId: price.id,
    });

    const payment = Payment.createManual({
      enrollmentId: enrollment.id,
      method: input.method,
      methodDetail: input.methodDetail,
      amountCents: price.amountCents,
      operationNumber: input.operationNumber,
    });

    const emailContext = await this.emailContextLookup.find({
      studentId: input.studentId,
      classGroupId: input.classGroupId,
    });

    // No context means the student or class group is not on file; the write
    // below fails on that by itself, exactly as it did before e-mails existed.
    const notifications = emailContext
      ? enrollmentReceivedEmails(
          { enrollmentId: enrollment.id, amountCents: price.amountCents, ...emailContext },
          DEFAULT_LOCALE,
        )
      : [];

    const created = await this.enrollmentRepository.createWithPayment({
      enrollment,
      payment,
      notifications,
      receipt: { receiptUploadId: input.receiptUploadId, uploadedBy: input.actorId },
    });

    // The exception path is the one that most needs a name on it: the
    // checkout is the student acting, this is staff acting for them.
    await this.auditLog.append({
      actorId: input.actorId,
      action: "enrollment.created",
      targetId: created.enrollment.id,
      metadata: { studentId: input.studentId, paymentId: created.payment.id, receiptUploadId: input.receiptUploadId },
      at: created.enrollment.createdAt,
    });

    return created;
  }
}
