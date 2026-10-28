import { DEFAULT_LOCALE, type EmailNotification } from "../notification/EmailNotification.js";
import { paymentUnderReviewEmails } from "../notification/enrollmentEmails.js";
import type { IPlatformSettingsRepository } from "../platform/ports/IPlatformSettingsRepository.js";
import { BaseUseCase } from "../shared/base/BaseUseCase.js";
import type { IEnrollmentEmailContextLookup } from "./EnrollmentEmailContextLookup.js";
import { decideReceiptVerdict, type ReceiptVerdictOutcome } from "./ReceiptValidation.js";
import type {
  IReceiptValidationRepository,
  ReceiptValidationEffect,
  ReceiptValidationSubject,
} from "./ReceiptValidationRepository.js";

export interface ValidateReceiptInput {
  receiptUploadId: string;
}

export interface ValidateReceiptOutput {
  /** `null` when there was nothing to validate. */
  outcome: ReceiptVerdictOutcome | null;
  effect: ReceiptValidationEffect | null;
}

/**
 * The receipt traffic light (OOC-21, ROADMAP Sessão 27), run by the
 * `receipt-validate` worker once a receipt is both screened and read.
 * Compares the amount read with the payment's frozen price under the
 * backoffice's settings, then hands the verdict to the repository.
 *
 * It only validates — approvals are never automatic (owner, 03/10/2026).
 * Green leaves the payment `pending` with the verdict on it; yellow and red
 * send it to `under_review`, and the student (with a minor's guardian) hears
 * about it — `payment_under_review` (OOC-87). Whoever approves or rejects is
 * a person in Payments (`SettlePaymentUseCase`).
 *
 * The e-mail goes out in es-PE: the enrollment does not record the language
 * its form was filled in.
 */
export class ValidateReceiptUseCase extends BaseUseCase<ValidateReceiptInput, ValidateReceiptOutput> {
  constructor(
    private readonly repository: IReceiptValidationRepository,
    private readonly settings: IPlatformSettingsRepository,
    private readonly emailContextLookup: IEnrollmentEmailContextLookup,
  ) {
    super();
  }

  async run(input: ValidateReceiptInput): Promise<ValidateReceiptOutput> {
    const subject = await this.repository.findSubject(input.receiptUploadId);
    if (!subject) {
      return { outcome: null, effect: null };
    }

    const current = await this.settings.get();
    const settings = {
      toleranceCents: current.receiptAmountToleranceCents,
      rejectBelowPercent: current.receiptRejectBelowPercent,
    };

    const outcome = decideReceiptVerdict({
      expectedCents: subject.expectedCents,
      declaredOperationNumber: subject.declaredOperationNumber,
      readAmountCents: subject.readAmountCents,
      readOperationNumber: subject.readOperationNumber,
      declaredMethod: subject.declaredMethod,
      readMethod: subject.readMethod,
      settings,
    });

    // Written only if the repository actually moves the payment: green
    // leaves it pending, and an older upload or a settled payment stays put.
    const notifications = outcome.verdict === "approve" ? [] : await this.underReviewEmails(subject);

    const effect = await this.repository.record({
      subject,
      outcome,
      detail: { reason: outcome.reason, expectedCents: subject.expectedCents, readCents: subject.readAmountCents, ...settings },
      notifications,
    });

    return { outcome, effect };
  }

  private async underReviewEmails(subject: ReceiptValidationSubject): Promise<EmailNotification[]> {
    const context = await this.emailContextLookup.find({ studentId: subject.studentId, classGroupId: subject.classGroupId });
    return context ? paymentUnderReviewEmails({ paymentId: subject.paymentId, ...context }, DEFAULT_LOCALE) : [];
  }
}
