import {
  RECEIPT_EXTRACTION_TIER_PRIMARY,
  PaymentMethodSchema,
  type IReceiptValidationRepository,
  type PaymentMethod,
  type PaymentStatus,
  type ReceiptValidationEffect,
  type ReceiptValidationSubject,
} from "@ooc/domain";
import { enrollments, paymentReceipts, payments, receiptUploads } from "@ooc/db";
import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import type { Db } from "@/infra/db/client.js";
import { insertOutboxEmails } from "@/infra/persistence/notification/DrizzleOutboxRepository.js";

/** The `payment_method` entry of `extracted_fields`, read defensively — a
 * value outside the enum counts as not read. */
function readPaymentMethod(fields: unknown): PaymentMethod | null {
  if (!Array.isArray(fields)) return null;
  const entry = fields.find(
    (item): item is { value?: unknown } => typeof item === "object" && item !== null && (item as { field?: unknown }).field === "payment_method",
  );
  const parsed = PaymentMethodSchema.safeParse(entry?.value);
  return parsed.success ? parsed.data : null;
}

/**
 * The receipt traffic light's writes (OOC-21). It records the verdict and,
 * at most, sends a payment to review — never approves, never rejects, never
 * touches the seat: approving is a person's act in Payments
 * (`DrizzlePaymentSettlementRepository`, owner's decision of 03/10/2026).
 */
export class DrizzleReceiptValidationRepository implements IReceiptValidationRepository {
  constructor(private readonly db: Db) {}

  async findSubject(receiptUploadId: string): Promise<ReceiptValidationSubject | null> {
    const [row] = await this.db
      .select({
        receiptUploadId: receiptUploads.id,
        paymentId: payments.id,
        studentId: enrollments.studentId,
        classGroupId: enrollments.classGroupId,
        paymentStatus: payments.status,
        expectedCents: payments.amountCents,
        declaredOperationNumber: payments.operationNumber,
        declaredMethod: payments.method,
        extractedFields: paymentReceipts.extractedFields,
        readAmountCents: paymentReceipts.amountCents,
        readOperationNumber: paymentReceipts.operationNumber,
      })
      .from(receiptUploads)
      .innerJoin(payments, eq(payments.id, receiptUploads.paymentId))
      .innerJoin(enrollments, eq(enrollments.id, payments.enrollmentId))
      // The level-1 row — a failed reading has one too, with null columns,
      // and validates as `amount_unread`.
      .innerJoin(
        paymentReceipts,
        and(eq(paymentReceipts.receiptUploadId, receiptUploads.id), eq(paymentReceipts.tier, RECEIPT_EXTRACTION_TIER_PRIMARY)),
      )
      .where(
        and(eq(receiptUploads.id, receiptUploadId), isNotNull(receiptUploads.screenedAt), isNull(receiptUploads.validatedAt)),
      )
      .limit(1);

    if (!row) return null;
    const { extractedFields, ...rest } = row;
    return {
      ...rest,
      paymentStatus: row.paymentStatus as PaymentStatus,
      declaredMethod: row.declaredMethod as PaymentMethod,
      readMethod: readPaymentMethod(extractedFields),
    };
  }

  async record(params: Parameters<IReceiptValidationRepository["record"]>[0]): Promise<ReceiptValidationEffect> {
    const { subject, outcome, detail, notifications } = params;

    return this.db.transaction(async (tx) => {
      const [stamped] = await tx
        .update(receiptUploads)
        .set({ validationVerdict: outcome.verdict, validationDetail: detail, validatedAt: sql`now()`, updatedAt: sql`now()` })
        .where(and(eq(receiptUploads.id, subject.receiptUploadId), isNull(receiptUploads.validatedAt)))
        .returning({ id: receiptUploads.id });
      if (!stamped) return "already_validated";

      // Green leaves the payment where it is: `pending`, with the verdict on
      // its receipt, until a person approves it.
      if (outcome.verdict === "approve") return "none";

      // Only the upload that speaks for the payment moves it — the most
      // recent one, by the same order the review queue uses
      // (ListPaymentReviewQueueQuery's `latestUpload`).
      const [newer] = await tx
        .select({ id: receiptUploads.id })
        .from(receiptUploads)
        .where(
          and(
            eq(receiptUploads.paymentId, subject.paymentId),
            sql`(${receiptUploads.createdAt}, ${receiptUploads.id}) > (
              select self.created_at, self.id from ${receiptUploads} self where self.id = ${subject.receiptUploadId}
            )`,
          ),
        )
        .limit(1);
      if (newer) return "none";

      // Conditional on `pending`: a reviewer who already settled the
      // payment wins, and the screening may already have routed it.
      const [routed] = await tx
        .update(payments)
        .set({ status: "under_review", updatedAt: sql`now()` })
        .where(and(eq(payments.id, subject.paymentId), eq(payments.status, "pending")))
        .returning({ id: payments.id });
      if (!routed) return "none";

      await insertOutboxEmails(tx, notifications);
      return "routed_to_review";
    });
  }
}
