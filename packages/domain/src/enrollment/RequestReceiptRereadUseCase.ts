import { BaseUseCase } from "../shared/base/BaseUseCase.js";
import { RECEIPT_EXTRACTION_TIER_PRIMARY } from "./ReceiptExtraction.js";
import type { IReceiptRereadRepository } from "./ReceiptRereadRepository.js";

export interface RequestReceiptRereadInput {
  actorId: string;
  paymentId: string;
}

export interface RequestReceiptRereadOutput {
  rereadId: string;
  receiptUploadId: string;
}

/**
 * A reviewer in Payments asks for a new reading of a receipt — the first one
 * failed, came out illegible, or the reviewer can see the model misread it
 * (ROADMAP Sessão 32). Only records the request: the model is called by the
 * `receipt-reread` worker, never on the request path (apps/api/CLAUDE.md,
 * "OCR — nunca síncrono").
 *
 * It never moves the payment: approving stays a person's act (owner,
 * 03/10/2026), and so does sending to review.
 */
export class RequestReceiptRereadUseCase extends BaseUseCase<RequestReceiptRereadInput, RequestReceiptRereadOutput> {
  constructor(private readonly rereads: IReceiptRereadRepository) {
    super();
  }

  async run(input: RequestReceiptRereadInput): Promise<RequestReceiptRereadOutput> {
    return this.rereads.request({
      paymentId: input.paymentId,
      actorId: input.actorId,
      tier: RECEIPT_EXTRACTION_TIER_PRIMARY,
    });
  }
}
