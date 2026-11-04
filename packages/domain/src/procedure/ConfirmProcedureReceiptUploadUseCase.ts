import { ReceiptNotUploadedError, ReceiptUploadNotFoundError } from "../enrollment/errors.js";
import type { IReceiptStorage } from "../enrollment/ReceiptStorage.js";
import type { IReceiptUploadRepository } from "../enrollment/ReceiptUploadRepository.js";
import { BaseUseCase } from "../shared/base/BaseUseCase.js";
import type { IProcedureRepository } from "./ProcedureRepository.js";

export interface ConfirmProcedureReceiptUploadInput {
  userId: string;
  requestId: string;
  receiptUploadId: string;
}

/**
 * The HEAD that confirms the portal's direct-to-bucket upload landed, the same
 * step as the checkout's. The upload must belong to a request of this account:
 * anything else answers as not found.
 */
export class ConfirmProcedureReceiptUploadUseCase extends BaseUseCase<ConfirmProcedureReceiptUploadInput, { receiptUploadId: string }> {
  constructor(
    private readonly procedures: IProcedureRepository,
    private readonly receiptUploads: IReceiptUploadRepository,
    private readonly storage: IReceiptStorage,
  ) {
    super();
  }

  async run(input: ConfirmProcedureReceiptUploadInput): Promise<{ receiptUploadId: string }> {
    const request = await this.procedures.findOwnRequest({ userId: input.userId, requestId: input.requestId });
    const row = request ? await this.receiptUploads.findById(input.receiptUploadId) : null;
    if (!request || !row || row.procedureRequestId !== request.id) throw new ReceiptUploadNotFoundError();

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
