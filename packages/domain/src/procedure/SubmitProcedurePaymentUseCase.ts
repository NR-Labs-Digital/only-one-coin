import type { PaymentMethod } from "../enrollment/Payment.js";
import { BaseUseCase } from "../shared/base/BaseUseCase.js";
import { ProcedureRequestNotFoundError } from "./errors.js";
import type { IProcedureRepository } from "./ProcedureRepository.js";

export interface SubmitProcedurePaymentInput {
  userId: string;
  requestId: string;
  receiptUploadId: string;
  method: PaymentMethod;
  operationNumber: string;
  idempotencyKey: string;
}

/**
 * The receipt goes in and the payment is born `pending`, on the same ladder as
 * an enrollment's: the relay picks the upload up once it is linked, and a person
 * settles it in Payments. Nothing here reads the receipt, and no amount comes
 * from the client — the payment is for what the request froze.
 */
export class SubmitProcedurePaymentUseCase extends BaseUseCase<SubmitProcedurePaymentInput, { paymentId: string }> {
  constructor(private readonly procedures: IProcedureRepository) {
    super();
  }

  async run(input: SubmitProcedurePaymentInput): Promise<{ paymentId: string }> {
    const request = await this.procedures.findOwnRequest({ userId: input.userId, requestId: input.requestId });
    if (!request) throw new ProcedureRequestNotFoundError();

    return this.procedures.submitPayment({
      requestId: request.id,
      receiptUploadId: input.receiptUploadId,
      method: input.method,
      operationNumber: input.operationNumber,
      idempotencyKey: input.idempotencyKey,
      actorId: input.userId,
    });
  }
}
