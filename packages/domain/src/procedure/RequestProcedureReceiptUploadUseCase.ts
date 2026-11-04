// TODO: switch to native crypto.randomUUIDv7() once engines.node requires >=26 (LTS ~out/2026)
import { v7 as uuid } from "uuid";
import type { PresignedReceiptUpload, IReceiptStorage } from "../enrollment/ReceiptStorage.js";
import type { IReceiptUploadRepository } from "../enrollment/ReceiptUploadRepository.js";
import type { ReceiptContentType } from "../enrollment/RequestReceiptUploadUseCase.js";
import { BaseUseCase } from "../shared/base/BaseUseCase.js";
import { ProcedureNotPayableError, ProcedureRequestNotFoundError } from "./errors.js";
import { acceptsPayment } from "./Procedure.js";
import type { IProcedureRepository } from "./ProcedureRepository.js";

export interface RequestProcedureReceiptUploadInput {
  userId: string;
  requestId: string;
  contentType: ReceiptContentType;
}

export interface RequestProcedureReceiptUploadOutput {
  receiptUploadId: string;
  upload: PresignedReceiptUpload;
  maxBytes: number;
}

/**
 * The checkout's upload target (`RequestReceiptUploadUseCase`) for a receipt
 * that hangs off a procedure request instead of a seat hold: same signed POST,
 * same worker afterwards, a key the server names.
 */
export class RequestProcedureReceiptUploadUseCase extends BaseUseCase<
  RequestProcedureReceiptUploadInput,
  RequestProcedureReceiptUploadOutput
> {
  constructor(
    private readonly procedures: IProcedureRepository,
    private readonly receiptUploads: IReceiptUploadRepository,
    private readonly storage: IReceiptStorage,
    private readonly maxBytes: number,
  ) {
    super();
  }

  async run(input: RequestProcedureReceiptUploadInput): Promise<RequestProcedureReceiptUploadOutput> {
    const request = await this.procedures.findOwnRequest({ userId: input.userId, requestId: input.requestId });
    if (!request) throw new ProcedureRequestNotFoundError();
    if (!acceptsPayment(request)) throw new ProcedureNotPayableError();

    const receiptUploadId = uuid();
    const objectKey = `receipts/raw/procedure/${request.id}/${receiptUploadId}`;

    await this.receiptUploads.create({
      id: receiptUploadId,
      owner: { kind: "procedure_request", procedureRequestId: request.id },
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
