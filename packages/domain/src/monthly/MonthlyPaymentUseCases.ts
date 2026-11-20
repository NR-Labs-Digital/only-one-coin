// TODO: switch to native crypto.randomUUIDv7() once engines.node requires >=26 (LTS ~out/2026)
import { v7 as uuid } from "uuid";
import { ReceiptNotUploadedError, ReceiptUploadNotFoundError } from "../enrollment/errors.js";
import type { PaymentMethod } from "../enrollment/Payment.js";
import type { IReceiptStorage, PresignedReceiptUpload } from "../enrollment/ReceiptStorage.js";
import type { IReceiptUploadRepository } from "../enrollment/ReceiptUploadRepository.js";
import type { ReceiptContentType } from "../enrollment/RequestReceiptUploadUseCase.js";
import { BaseUseCase } from "../shared/base/BaseUseCase.js";
import { MonthlyEnrollmentNotFoundError } from "./errors.js";
import type { IMonthlyPaymentRepository, MonthlyPaymentSubmitted } from "./MonthlyPaymentRepository.js";

/*
 * Buying monthly modules from the portal (OOC-86, CLAUDE.md §1): the student
 * pays the module they are on, and may pay the following ones ahead, with one
 * receipt. The receipt goes up the same signed POST and down the same ladder
 * as every other; a person settles it in Payments. The account is always the
 * session's, and an enrollment it does not reach answers as one that does
 * not exist.
 */

/** Where a monthly receipt lives before its payment exists: under the enrollment, named by the server. */
export function monthlyReceiptObjectKey(enrollmentId: string, receiptUploadId: string): string {
  return `receipts/raw/monthly/${enrollmentId}/${receiptUploadId}`;
}

export interface RequestMonthlyReceiptUploadInput {
  userId: string;
  enrollmentId: string;
  contentType: ReceiptContentType;
}

export class RequestMonthlyReceiptUploadUseCase extends BaseUseCase<
  RequestMonthlyReceiptUploadInput,
  { receiptUploadId: string; upload: PresignedReceiptUpload; maxBytes: number }
> {
  constructor(
    private readonly monthly: IMonthlyPaymentRepository,
    private readonly receiptUploads: IReceiptUploadRepository,
    private readonly storage: IReceiptStorage,
    private readonly maxBytes: number,
  ) {
    super();
  }

  async run(input: RequestMonthlyReceiptUploadInput) {
    const enrollment = await this.monthly.findOwnEnrollment({ userId: input.userId, enrollmentId: input.enrollmentId });
    if (!enrollment) throw new MonthlyEnrollmentNotFoundError();

    const receiptUploadId = uuid();
    const objectKey = monthlyReceiptObjectKey(enrollment.enrollmentId, receiptUploadId);
    // The account is the owner until the payment exists, as the staff account
    // is for a manual enrollment (OOC-146); the key ties it to the enrollment.
    await this.receiptUploads.create({
      id: receiptUploadId,
      owner: { kind: "account", userId: input.userId },
      objectKey,
      contentType: input.contentType,
    });
    const upload = await this.storage.createUploadTarget({ objectKey, contentType: input.contentType, maxBytes: this.maxBytes });
    return { receiptUploadId, upload, maxBytes: this.maxBytes };
  }
}

export interface ConfirmMonthlyReceiptUploadInput {
  userId: string;
  enrollmentId: string;
  receiptUploadId: string;
}

/** The HEAD that confirms the upload landed. Someone else's upload, or one of another enrollment, is not found. */
export class ConfirmMonthlyReceiptUploadUseCase extends BaseUseCase<ConfirmMonthlyReceiptUploadInput, { receiptUploadId: string }> {
  constructor(
    private readonly monthly: IMonthlyPaymentRepository,
    private readonly receiptUploads: IReceiptUploadRepository,
    private readonly storage: IReceiptStorage,
  ) {
    super();
  }

  async run(input: ConfirmMonthlyReceiptUploadInput): Promise<{ receiptUploadId: string }> {
    const enrollment = await this.monthly.findOwnEnrollment({ userId: input.userId, enrollmentId: input.enrollmentId });
    const row = enrollment ? await this.receiptUploads.findById(input.receiptUploadId) : null;
    if (
      !enrollment ||
      !row ||
      row.uploadedBy !== input.userId ||
      row.objectKey !== monthlyReceiptObjectKey(enrollment.enrollmentId, row.id)
    ) {
      throw new ReceiptUploadNotFoundError();
    }

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

export interface SubmitMonthlyPaymentInput {
  userId: string;
  enrollmentId: string;
  receiptUploadId: string;
  method: PaymentMethod;
  operationNumber: string;
  moduleCount: number;
  idempotencyKey: string;
}

/**
 * The receipt goes in and the payment is born `pending`. No amount comes from
 * the client: it is `moduleCount` times the module's price in force today,
 * worked out with the enrollment locked. Never a discount, never a debt.
 */
export class SubmitMonthlyPaymentUseCase extends BaseUseCase<SubmitMonthlyPaymentInput, MonthlyPaymentSubmitted> {
  constructor(private readonly monthly: IMonthlyPaymentRepository) {
    super();
  }

  async run(input: SubmitMonthlyPaymentInput): Promise<MonthlyPaymentSubmitted> {
    const enrollment = await this.monthly.findOwnEnrollment({ userId: input.userId, enrollmentId: input.enrollmentId });
    if (!enrollment) throw new MonthlyEnrollmentNotFoundError();

    return this.monthly.submitPayment({
      enrollmentId: enrollment.enrollmentId,
      receiptUploadId: input.receiptUploadId,
      userId: input.userId,
      method: input.method,
      operationNumber: input.operationNumber,
      moduleCount: input.moduleCount,
      idempotencyKey: input.idempotencyKey,
    });
  }
}
