import type { IPlatformSettingsRepository } from "../platform/ports/IPlatformSettingsRepository.js";
import { BaseUseCase } from "../shared/base/BaseUseCase.js";
import {
  ReceiptExtractionError,
  findExtractedField,
  type IReceiptExtractor,
  type ReceiptExtraction,
  type ReceiptExtractionFailureReason,
} from "./ReceiptExtraction.js";
import type { IReceiptImageReader } from "./ReceiptExtractionRepository.js";
import type { IReceiptRereadRepository, ReceiptRereadResult, ReceiptRereadSubject } from "./ReceiptRereadRepository.js";
import { decideReceiptVerdict, type ReceiptVerdictOutcome } from "./ReceiptValidation.js";

/** The normalize worker always re-encodes to JPEG (normalizeReceiptImage). */
const PROCESSED_RECEIPT_CONTENT_TYPE = "image/jpeg";

export interface RereadReceiptInput {
  rereadId: string;
}

export interface RereadReceiptOutput {
  /** `null` when there was nothing to do — unknown or already answered. */
  extraction: ReceiptExtraction | null;
  outcome: ReceiptVerdictOutcome | null;
}

export interface RecordReceiptRereadFailureInput {
  rereadId: string;
  error: unknown;
}

/**
 * Answers a re-read request (ROADMAP Sessão 32), run by the `receipt-reread`
 * worker. Same model, same image and same failure handling as level 1
 * (`ExtractReceiptUseCase`); then the traffic light's rule, under today's
 * settings, judges the new reading — owner's decision of 22/10/2026.
 *
 * Unlike the first validation, the verdict here never moves the payment: a
 * green re-read of a payment in review stays in review, a red one of a
 * pending payment stays pending. A person decides either way.
 */
export class RereadReceiptUseCase extends BaseUseCase<RereadReceiptInput, RereadReceiptOutput> {
  constructor(
    private readonly rereads: IReceiptRereadRepository,
    private readonly images: IReceiptImageReader,
    private readonly extractor: IReceiptExtractor,
    private readonly settings: IPlatformSettingsRepository,
  ) {
    super();
  }

  async run(input: RereadReceiptInput): Promise<RereadReceiptOutput> {
    const subject = await this.rereads.findPending(input.rereadId);
    if (!subject) {
      return { extraction: null, outcome: null };
    }

    const bytes = await this.images.read(subject.processedObjectKey);
    const extraction = await this.extractor.extract({ bytes, contentType: PROCESSED_RECEIPT_CONTENT_TYPE });
    const outcome = await this.judgeAndRecord(subject, { kind: "read", extraction });

    return { extraction, outcome };
  }

  /** The attempts ran out: the failure is the answer, judged like a failed
   * first reading (`amount_unread`). */
  async recordFailure(input: RecordReceiptRereadFailureInput): Promise<ReceiptExtractionFailureReason | null> {
    const subject = await this.rereads.findPending(input.rereadId);
    if (!subject) {
      return null;
    }

    const reason = input.error instanceof ReceiptExtractionError ? input.error.reason : "unexpected_error";
    await this.judgeAndRecord(subject, { kind: "failed", modelName: this.extractor.modelName, reason });
    return reason;
  }

  private async judgeAndRecord(subject: ReceiptRereadSubject, result: ReceiptRereadResult): Promise<ReceiptVerdictOutcome> {
    const current = await this.settings.get();
    const settings = {
      toleranceCents: current.receiptAmountToleranceCents,
      rejectBelowPercent: current.receiptRejectBelowPercent,
    };

    const extraction = result.kind === "read" ? result.extraction : null;
    const readAmountCents = (extraction && findExtractedField(extraction, "amount_cents")?.value) ?? null;
    const outcome = decideReceiptVerdict({
      expectedCents: subject.expectedCents,
      declaredOperationNumber: subject.declaredOperationNumber,
      readAmountCents,
      readOperationNumber: (extraction && findExtractedField(extraction, "operation_number")?.value) ?? null,
      declaredMethod: subject.declaredMethod,
      readMethod: (extraction && findExtractedField(extraction, "payment_method")?.value) ?? null,
      settings,
    });

    await this.rereads.record({
      subject,
      result,
      outcome,
      detail: { reason: outcome.reason, expectedCents: subject.expectedCents, readCents: readAmountCents, ...settings },
    });
    return outcome;
  }
}
