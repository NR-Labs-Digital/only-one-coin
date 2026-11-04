// TODO: switch to native crypto.randomUUIDv7() once engines.node requires >=26 (LTS ~out/2026)
import { v7 as uuid } from "uuid";
import { BaseUseCase } from "../shared/base/BaseUseCase.js";
import { SeatHoldExpiredError } from "./errors.js";
import type { PresignedReceiptUpload, IReceiptStorage } from "./ReceiptStorage.js";
import type { IReceiptUploadRepository } from "./ReceiptUploadRepository.js";
import type { ISeatHoldRepository } from "./SeatHoldRepository.js";

export const RECEIPT_CONTENT_TYPES = ["image/jpeg", "image/png", "image/heic", "image/heif"] as const;
export type ReceiptContentType = (typeof RECEIPT_CONTENT_TYPES)[number];

export interface RequestReceiptUploadInput {
  /** The checkout's own hold — the only server-minted id that exists at
   * this point (enrollment and payment are only born at submit). */
  seatHoldId: string;
  /** The browser's own read of the file (`File.type`), used only to build
   * the upload policy and name the object — never trusted for the actual
   * accept/reject decision, which the normalize worker makes from the bytes
   * themselves once they land (apps/api/CLAUDE.md, "Upload"). */
  contentType: ReceiptContentType;
}

export interface RequestReceiptUploadOutput {
  receiptUploadId: string;
  upload: PresignedReceiptUpload;
  maxBytes: number;
}

/**
 * Mints the target the checkout PUTs the receipt photo straight to — the
 * app's own function never sees the bytes (CLAUDE.md §6). The object key is
 * scoped by the seat hold and an unguessable id of its own
 * (`receipts/raw/<seatHoldId>/<receiptUploadId>`), never a name the client
 * chose (CLAUDE.md §1, "caminho do arquivo... nunca previsível").
 *
 * The hold must still exist — an expired or unknown one means the checkout
 * has already restarted from the class group step, and minting an upload
 * target for a hold that is gone would let a receipt outlive the seat it was
 * for.
 */
export class RequestReceiptUploadUseCase extends BaseUseCase<RequestReceiptUploadInput, RequestReceiptUploadOutput> {
  constructor(
    private readonly seatHolds: ISeatHoldRepository,
    private readonly receiptUploads: IReceiptUploadRepository,
    private readonly storage: IReceiptStorage,
    private readonly maxBytes: number,
  ) {
    super();
  }

  async run(input: RequestReceiptUploadInput): Promise<RequestReceiptUploadOutput> {
    const hold = await this.seatHolds.find(input.seatHoldId);
    if (!hold) {
      throw new SeatHoldExpiredError();
    }

    const receiptUploadId = uuid();
    const objectKey = `receipts/raw/${hold.id}/${receiptUploadId}`;

    await this.receiptUploads.create({
      id: receiptUploadId,
      owner: { kind: "seat_hold", seatHoldId: hold.id },
      objectKey,
      contentType: input.contentType,
    });

    const upload = await this.storage.createUploadTarget({
      objectKey,
      contentType: input.contentType,
      maxBytes: this.maxBytes,
    });

    return { receiptUploadId, upload, maxBytes: this.maxBytes };
  }
}
