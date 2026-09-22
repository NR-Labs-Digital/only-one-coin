import {
  ClassGroupFullError,
  Enrollment,
  Payment,
  type IEnrollmentRepository,
  type PaymentMethod,
  type PaymentStatus,
  type SeatStatus,
} from "@ooc/domain";
import { classGroups, enrollments, payments } from "@ooc/db";
import { and, eq, isNull, lt, sql } from "drizzle-orm";
import type { Db } from "@/infra/db/client.js";

export class DrizzleEnrollmentRepository implements IEnrollmentRepository {
  constructor(private readonly db: Db) {}

  async createWithPayment(params: {
    enrollment: Enrollment;
    payment: Payment;
  }): Promise<{ enrollment: Enrollment; payment: Payment }> {
    const { enrollment, payment } = params;

    return this.db.transaction(async (tx) => {
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

      return {
        enrollment: new Enrollment({
          id: enrollmentRow.id,
          studentId: enrollmentRow.studentId,
          classGroupId: enrollmentRow.classGroupId,
          planPriceId: enrollmentRow.planPriceId,
          seatStatus: enrollmentRow.seatStatus as SeatStatus,
        }),
        payment: new Payment({
          id: paymentRow.id,
          enrollmentId: paymentRow.enrollmentId,
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
