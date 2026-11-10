// TODO: switch to native crypto.randomUUIDv7() once engines.node requires >=26 (LTS ~out/2026)
import { v7 as uuid } from "uuid";
import { BaseUseCase } from "../shared/base/BaseUseCase.js";
import type { PresignedReceiptUpload, IReceiptStorage } from "./ReceiptStorage.js";
import type { IReceiptUploadRepository } from "./ReceiptUploadRepository.js";
import type { ReceiptContentType } from "./RequestReceiptUploadUseCase.js";

export interface RequestManualReceiptUploadInput {
  /** The staff account opening the manual enrollment — the receipt's owner
   * until the enrollment's payment exists (OOC-146). */
  actorId: string;
  contentType: ReceiptContentType;
}

export interface RequestManualReceiptUploadOutput {
  receiptUploadId: string;
  upload: PresignedReceiptUpload;
  maxBytes: number;
}

/**
 * The checkout's upload target (`RequestReceiptUploadUseCase`) for the manual
 * backoffice enrollment, whose receipt is mandatory since OOC-146. Same signed
 * POST, same worker afterwards, a key the server names. Before the enrollment
 * exists there is no hold and no request to scope the file by, so the owner is
 * the staff account itself — only it can confirm the upload or attach it.
 */
export class RequestManualReceiptUploadUseCase extends BaseUseCase<
  RequestManualReceiptUploadInput,
  RequestManualReceiptUploadOutput
> {
  constructor(
    private readonly receiptUploads: IReceiptUploadRepository,
    private readonly storage: IReceiptStorage,
    private readonly maxBytes: number,
  ) {
    super();
  }

  async run(input: RequestManualReceiptUploadInput): Promise<RequestManualReceiptUploadOutput> {
    const receiptUploadId = uuid();
    const objectKey = `receipts/raw/manual/${receiptUploadId}`;

    await this.receiptUploads.create({
      id: receiptUploadId,
      owner: { kind: "staff", userId: input.actorId },
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
