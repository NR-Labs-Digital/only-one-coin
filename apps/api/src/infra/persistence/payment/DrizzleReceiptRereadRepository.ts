import {
  PaymentAlreadySettledError,
  PaymentNotFoundError,
  ReceiptNotRereadableError,
  ReceiptRereadInProgressError,
  findExtractedField,
  type IReceiptRereadRepository,
  type PaymentMethod,
  type ReceiptRereadSubject,
} from "@ooc/domain";
import { auditLog, payments, receiptRereads, receiptUploads } from "@ooc/db";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "@/infra/db/client.js";
import { OPEN_STATUSES } from "./ListPaymentsQuery.js";

/** What the receipt upload relay needs to offer pending re-reads — infra a
 * worker consumes directly, like `IReceiptNormalizationStore`. */
export interface IReceiptRereadRelayStore {
  listPendingIds(limit: number): Promise<string[]>;
}

/**
 * Re-reads of a receipt (ROADMAP Sessão 32). The request and its audit entry
 * are one transaction; the worker's answer is one conditional UPDATE. Never
 * writes `payments` — a re-read only informs the person who settles.
 */
export class DrizzleReceiptRereadRepository implements IReceiptRereadRepository, IReceiptRereadRelayStore {
  constructor(private readonly db: Db) {}

  async request(params: { paymentId: string; actorId: string; tier: number }): Promise<{ rereadId: string; receiptUploadId: string }> {
    return this.db.transaction(async (tx) => {
      const [payment] = await tx
        .select({ status: payments.status })
        .from(payments)
        .where(eq(payments.id, params.paymentId));
      if (!payment) throw new PaymentNotFoundError();
      if (!(OPEN_STATUSES as string[]).includes(payment.status)) throw new PaymentAlreadySettledError();

      // The upload that speaks for the payment — the same choice the review
      // queue makes (ListPaymentReviewQueueQuery's `latestUpload`), so the
      // reviewer re-reads the image they are looking at.
      const [upload] = await tx
        .select({ id: receiptUploads.id, status: receiptUploads.status })
        .from(receiptUploads)
        .where(eq(receiptUploads.paymentId, params.paymentId))
        .orderBy(desc(receiptUploads.createdAt), desc(receiptUploads.id))
        .limit(1);
      if (!upload || upload.status !== "processed") throw new ReceiptNotRereadableError();

      // One pending request per receipt, held by receipt_rereads_pending_uidx:
      // a double click lands on the index instead of a second model call.
      const [inserted] = await tx
        .insert(receiptRereads)
        .values({
          paymentId: params.paymentId,
          receiptUploadId: upload.id,
          requestedBy: params.actorId,
          tier: params.tier,
        })
        .onConflictDoNothing({
          target: receiptRereads.receiptUploadId,
          where: sql`${receiptRereads.readAt} is null`,
        })
        .returning({ id: receiptRereads.id });
      if (!inserted) throw new ReceiptRereadInProgressError();

      await tx.insert(auditLog).values({
        actorId: params.actorId,
        action: "payment.receipt_reread_requested",
        targetId: params.paymentId,
        metadata: { receiptUploadId: upload.id, rereadId: inserted.id },
      });

      return { rereadId: inserted.id, receiptUploadId: upload.id };
    });
  }

  async findPending(rereadId: string): Promise<ReceiptRereadSubject | null> {
    const [row] = await this.db
      .select({
        rereadId: receiptRereads.id,
        receiptUploadId: receiptRereads.receiptUploadId,
        paymentId: receiptRereads.paymentId,
        tier: receiptRereads.tier,
        processedObjectKey: receiptUploads.processedObjectKey,
        expectedCents: payments.amountCents,
        declaredOperationNumber: payments.operationNumber,
        declaredMethod: payments.method,
      })
      .from(receiptRereads)
      .innerJoin(receiptUploads, eq(receiptUploads.id, receiptRereads.receiptUploadId))
      .innerJoin(payments, eq(payments.id, receiptRereads.paymentId))
      .where(and(eq(receiptRereads.id, rereadId), isNull(receiptRereads.readAt)))
      .limit(1);

    if (!row?.processedObjectKey) return null;
    return { ...row, processedObjectKey: row.processedObjectKey, declaredMethod: row.declaredMethod as PaymentMethod };
  }

  /** Same column split as the first reading (DrizzleReceiptExtractionRepository):
   * amount and operation number copied out of the JSON. */
  async record(params: Parameters<IReceiptRereadRepository["record"]>[0]): Promise<boolean> {
    const { subject, result, outcome, detail } = params;
    const extraction = result.kind === "read" ? result.extraction : null;

    const [stamped] = await this.db
      .update(receiptRereads)
      .set({
        modelName: extraction ? extraction.modelName : result.kind === "failed" ? result.modelName : null,
        modelVersion: extraction?.modelVersion ?? null,
        amountCents: (extraction && findExtractedField(extraction, "amount_cents")?.value) ?? null,
        operationNumber: (extraction && findExtractedField(extraction, "operation_number")?.value) ?? null,
        extractedFields: extraction?.fields ?? null,
        failureReason: result.kind === "failed" ? result.reason : null,
        validationVerdict: outcome.verdict,
        validationDetail: detail,
        readAt: sql`now()`,
      })
      .where(and(eq(receiptRereads.id, subject.rereadId), isNull(receiptRereads.readAt)))
      .returning({ id: receiptRereads.id });

    return stamped !== undefined;
  }

  async listPendingIds(limit: number): Promise<string[]> {
    const rows = await this.db
      .select({ id: receiptRereads.id })
      .from(receiptRereads)
      .where(isNull(receiptRereads.readAt))
      .orderBy(asc(receiptRereads.createdAt))
      .limit(limit);
    return rows.map((row) => row.id);
  }
}
