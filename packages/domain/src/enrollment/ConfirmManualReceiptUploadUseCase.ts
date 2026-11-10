import { BaseUseCase } from "../shared/base/BaseUseCase.js";
import { ReceiptNotUploadedError, ReceiptUploadNotFoundError } from "./errors.js";
import type { IReceiptStorage } from "./ReceiptStorage.js";
import type { IReceiptUploadRepository } from "./ReceiptUploadRepository.js";

export interface ConfirmManualReceiptUploadInput {
  actorId: string;
  receiptUploadId: string;
}

/**
 * The HEAD that confirms the manual enrollment's direct-to-bucket upload
 * landed — the checkout's step. The upload must have been started by this
 * same staff account: anyone else's answers as not found.
 */
export class ConfirmManualReceiptUploadUseCase extends BaseUseCase<
  ConfirmManualReceiptUploadInput,
  { receiptUploadId: string }
> {
  constructor(
    private readonly receiptUploads: IReceiptUploadRepository,
    private readonly storage: IReceiptStorage,
  ) {
    super();
  }

  async run(input: ConfirmManualReceiptUploadInput): Promise<{ receiptUploadId: string }> {
    const row = await this.receiptUploads.findById(input.receiptUploadId);
    // The owner is compared only once it is known to be present: a null
    // owner is not an id (CLAUDE.md §8).
    if (!row || row.uploadedBy === null || row.uploadedBy !== input.actorId) throw new ReceiptUploadNotFoundError();

    if (row.status !== "pending") return { receiptUploadId: row.id };

    const head = await this.storage.headObject(row.objectKey);
    if (!head) throw new ReceiptNotUploadedError();

    await this.receiptUploads.markUploaded(row.id, {
      contentType: head.contentType ?? "application/octet-stream",
      byteSize: head.byteSize,
    });
    return { receiptUploadId: row.id };
  }
}
