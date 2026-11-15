import {
  Enrollment,
  ReceiptNotReadyError,
  Payment,
  type EmailNotification,
  type EnrollmentOrigin,
  type IEnrollmentRepository,
  type PaymentMethod,
  type PaymentStatus,
  type SeatStatus,
} from "@ooc/domain";
import { enrollments, payments, receiptUploads, waitlistEntries } from "@ooc/db";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "@/infra/db/client.js";
import { insertOutboxEmails } from "@/infra/persistence/notification/DrizzleOutboxRepository.js";
import { assertOperationNumberUnused } from "./operationNumberGuard.js";
import { takeManualSeat } from "./takeManualSeat.js";
import { entryModuleIdOf } from "@/infra/persistence/catalog/classGroupModuleSql.js";

export class DrizzleEnrollmentRepository implements IEnrollmentRepository {
  constructor(private readonly db: Db) {}

  async createWithPayment(params: {
    enrollment: Enrollment;
    payment: Payment;
    notifications: EmailNotification[];
    receipt: { receiptUploadId: string; uploadedBy: string };
    allowOverCapacity?: boolean;
  }): Promise<{ enrollment: Enrollment; payment: Payment }> {
    const { enrollment, payment } = params;

    return this.db.transaction(async (tx) => {
      // The receipt is mandatory (OOC-146): this account's own upload,
      // confirmed, and not yet paying for anything. Locked first, so two
      // submits with the same file never both attach it — and checked before
      // the seat is taken, so a refusal costs nothing to undo.
      const [receipt] = await tx
        .select({ id: receiptUploads.id })
        .from(receiptUploads)
        .where(
          and(
            eq(receiptUploads.id, params.receipt.receiptUploadId),
            eq(receiptUploads.uploadedBy, params.receipt.uploadedBy),
            inArray(receiptUploads.status, ["uploaded", "processed"]),
            isNull(receiptUploads.paymentId),
          ),
        )
        .for("update");
      if (!receipt) {
        throw new ReceiptNotReadyError();
      }

      // Staff typing an operation number that already paid for someone else
      // is refused the same way the checkout is (OOC-22) — before the seat
      // is taken, so a refusal costs nothing to undo.
      await assertOperationNumberUnused(tx, {
        method: payment.method,
        operationNumber: payment.operationNumber ?? "",
      });

      const overCapacity = await takeManualSeat(tx, {
        classGroupId: enrollment.classGroupId,
        allowOverCapacity: params.allowOverCapacity ?? false,
      });

      const [enrollmentRow] = await tx
        .insert(enrollments)
        .values({
          id: enrollment.id,
          studentId: enrollment.studentId,
          classGroupId: enrollment.classGroupId,
          // A new student starts in the class group's entry run (OOC-156).
          classGroupModuleId: entryModuleIdOf(enrollment.classGroupId),
          planPriceId: enrollment.planPriceId,
          seatStatus: enrollment.seatStatus,
          origin: enrollment.origin,
          overCapacity,
        })
        .returning();

      if (!enrollmentRow) {
        throw new Error("Insert into enrollments returned no row");
      }

      const [paymentRow] = await tx
        .insert(payments)
        .values({
          id: payment.id,
          enrollmentId: payment.enrollmentId,
          idempotencyKey: payment.idempotencyKey,
          status: payment.status,
          method: payment.method,
          methodDetail: payment.methodDetail,
          amountCents: payment.amountCents,
          operationNumber: payment.operationNumber,
        })
        .returning();

      if (!paymentRow) {
        throw new Error("Insert into payments returned no row");
      }

      // Filled the moment the payment exists, as the checkout does: from
      // here the relay offers the file to the OCR ladder.
      await tx
        .update(receiptUploads)
        .set({ paymentId: paymentRow.id, updatedAt: sql`now()` })
        .where(eq(receiptUploads.id, receipt.id));

      // A seat taken from the waitlist closes the student's place in the
      // queue in the same transaction (OOC-35) — the queue never shows
      // somebody who is already in.
      await tx
        .update(waitlistEntries)
        .set({ leftAt: sql`now()`, leftReason: "enrolled", updatedAt: sql`now()` })
        .where(
          and(
            eq(waitlistEntries.classGroupId, enrollment.classGroupId),
            eq(waitlistEntries.studentId, enrollment.studentId),
            isNull(waitlistEntries.leftAt),
          ),
        );

      // Same transaction as the enrollment: the e-mail exists exactly when
      // the enrollment it talks about does (apps/api/CLAUDE.md, outbox).
      await insertOutboxEmails(tx, params.notifications);

      return {
        enrollment: new Enrollment({
          id: enrollmentRow.id,
          studentId: enrollmentRow.studentId,
          classGroupId: enrollmentRow.classGroupId,
          planPriceId: enrollmentRow.planPriceId,
          seatStatus: enrollmentRow.seatStatus as SeatStatus,
          origin: enrollmentRow.origin as EnrollmentOrigin,
          overCapacity: enrollmentRow.overCapacity,
        }),
        payment: new Payment({
          id: paymentRow.id,
          enrollmentId: enrollmentRow.id,
          idempotencyKey: paymentRow.idempotencyKey,
          status: paymentRow.status as PaymentStatus,
          method: paymentRow.method as PaymentMethod,
          methodDetail: paymentRow.methodDetail,
          amountCents: paymentRow.amountCents,
          operationNumber: paymentRow.operationNumber,
        }),
      };
    });
  }
}
