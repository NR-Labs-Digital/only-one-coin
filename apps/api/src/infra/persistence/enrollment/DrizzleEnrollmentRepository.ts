import {
  ClassGroupFullError,
  Enrollment,
  Payment,
  type EmailNotification,
  type EnrollmentOrigin,
  type IEnrollmentRepository,
  type PaymentMethod,
  type PaymentStatus,
  type SeatStatus,
} from "@ooc/domain";
import { classGroups, enrollments, payments, waitlistEntries } from "@ooc/db";
import { and, eq, isNull, lt, ne, sql } from "drizzle-orm";
import type { Db } from "@/infra/db/client.js";
import { insertOutboxEmails } from "@/infra/persistence/notification/DrizzleOutboxRepository.js";
import { assertOperationNumberUnused } from "./operationNumberGuard.js";

export class DrizzleEnrollmentRepository implements IEnrollmentRepository {
  constructor(private readonly db: Db) {}

  async createWithPayment(params: {
    enrollment: Enrollment;
    payment: Payment;
    notifications: EmailNotification[];
  }): Promise<{ enrollment: Enrollment; payment: Payment }> {
    const { enrollment, payment } = params;

    return this.db.transaction(async (tx) => {
      // Staff typing an operation number that already paid for someone else
      // is refused the same way the checkout is (OOC-22) — before the seat
      // is taken, so a refusal costs nothing to undo.
      await assertOperationNumberUnused(tx, {
        method: payment.method,
        operationNumber: payment.operationNumber ?? "",
      });

      // The single atomic instruction CLAUDE.md §5 requires: seat validation
      // never happens in application code, only in this WHERE clause. Zero
      // rows back means the class group is full.
      const [reservedSeat] = await tx
        .update(classGroups)
        .set({ seatsTaken: sql`${classGroups.seatsTaken} + 1` })
        // isNull guards the window between resolving the offer and writing:
        // a class group retired in between must not take the seat. Zero rows
        // back is the same answer as full, which is what the caller already
        // handles.
        .where(
          and(
            eq(classGroups.id, enrollment.classGroupId),
            lt(classGroups.seatsTaken, classGroups.capacity),
            isNull(classGroups.deletedAt),
            // A draft has no dates and is not on sale (OOC-35); zero rows is the same answer as full, which the caller already handles.
            // No enrollment-window check here on purpose: staff enrolling outside the window is the documented exception.
            ne(classGroups.status, "draft"),
          ),
        )
        .returning({ seatsTaken: classGroups.seatsTaken });

      if (!reservedSeat) {
        throw new ClassGroupFullError();
      }

      const [enrollmentRow] = await tx
        .insert(enrollments)
        .values({
          id: enrollment.id,
          studentId: enrollment.studentId,
          classGroupId: enrollment.classGroupId,
          planPriceId: enrollment.planPriceId,
          seatStatus: enrollment.seatStatus,
          origin: enrollment.origin,
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
