import { DEFAULT_LOCALE, type EmailNotification } from "../notification/EmailNotification.js";
import { paymentUnderReviewEmails } from "../notification/enrollmentEmails.js";
import { BaseUseCase } from "../shared/base/BaseUseCase.js";
import type { IEnrollmentEmailContextLookup } from "./EnrollmentEmailContextLookup.js";
import { exifSignals, routesToHumanReview, type ReceiptFraudSignal } from "./ReceiptScreening.js";
import type {
  IReceiptScreeningRepository,
  ReceiptLookalike,
  ReceiptScreeningSubject,
} from "./ReceiptScreeningRepository.js";

export interface ScreenReceiptUploadInput {
  receiptUploadId: string;
}

export interface ScreenReceiptUploadOutput {
  /** `null` when there was nothing to screen (see
   * `IReceiptScreeningRepository.findSubject`). */
  signals: ReceiptFraudSignal[] | null;
  routedToReview: boolean;
}

/** How many lookalikes a screening names. The reviewer needs the closest
 * few to compare side by side, not every Yape receipt of the same price. */
export const MAX_LOOKALIKE_SIGNALS = 5;

/**
 * Level 0 of the OCR ladder (apps/api/CLAUDE.md), run by the
 * `receipt-screen` worker once a receipt is both normalized and attached to
 * a payment — whichever of the two happens last. Collects every antifraud
 * signal (identical file, similar image, EXIF) and records them all; the
 * ones `routesToHumanReview` names send the payment to the human queue.
 * Nothing here rejects a payment: the decision is the reviewer's (decisions
 * of 30/09/2026). Routing it tells the student — `payment_under_review`
 * (OOC-87), in es-PE like every enrollment e-mail.
 */
export class ScreenReceiptUploadUseCase extends BaseUseCase<ScreenReceiptUploadInput, ScreenReceiptUploadOutput> {
  constructor(
    private readonly repository: IReceiptScreeningRepository,
    private readonly emailContextLookup: IEnrollmentEmailContextLookup,
  ) {
    super();
  }

  async run(input: ScreenReceiptUploadInput): Promise<ScreenReceiptUploadOutput> {
    const subject = await this.repository.findSubject(input.receiptUploadId);
    if (!subject) {
      return { signals: null, routedToReview: false };
    }

    const lookalikes = await this.repository.findLookalikes(subject);
    const signals = [...lookalikeSignals(lookalikes), ...exifSignals(subject.exif)];
    const routeToReview = signals.some(routesToHumanReview);
    const notifications = routeToReview ? await this.underReviewEmails(subject) : [];

    await this.repository.recordScreening({
      receiptUploadId: subject.receiptUploadId,
      paymentId: subject.paymentId,
      signals,
      routeToReview,
      notifications,
    });

    return { signals, routedToReview: routeToReview };
  }

  /** What the student never sees is why: the e-mail says a person is
   * checking the receipt, not that it looked like another one. */
  private async underReviewEmails(subject: ReceiptScreeningSubject): Promise<EmailNotification[]> {
    const context = await this.emailContextLookup.find({ studentId: subject.studentId, classGroupId: subject.classGroupId });
    return context ? paymentUnderReviewEmails({ paymentId: subject.paymentId, ...context }, DEFAULT_LOCALE) : [];
  }
}

function lookalikeSignals(lookalikes: ReceiptLookalike[]): ReceiptFraudSignal[] {
  // Identical files first: they are the ones a reviewer should open first.
  const ordered = [...lookalikes].sort((a, b) => rank(a) - rank(b));

  return ordered.slice(0, MAX_LOOKALIKE_SIGNALS).map((lookalike) =>
    lookalike.match.kind === "identical"
      ? { kind: "identical_file", receiptUploadId: lookalike.receiptUploadId, paymentId: lookalike.paymentId }
      : {
          kind: "similar_image",
          receiptUploadId: lookalike.receiptUploadId,
          paymentId: lookalike.paymentId,
          distance: lookalike.match.distance,
        },
  );
}

function rank(lookalike: ReceiptLookalike): number {
  return lookalike.match.kind === "identical" ? -1 : lookalike.match.distance;
}
