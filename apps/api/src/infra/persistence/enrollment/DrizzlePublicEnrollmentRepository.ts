import {
  ClassGroupFullError,
  Enrollment,
  Guardian,
  Payment,
  Student,
  type GuardianRelationship,
  type IPublicEnrollmentRepository,
  type NationalIdType,
  type PaymentMethod,
  type PaymentStatus,
  type PublicEnrollmentContext,
  type SeatStatus,
  type SubmitPublicEnrollmentParams,
  type SubmitPublicEnrollmentResult,
} from "@ooc/domain";
import { classGroups, consents, courses, enrollments, guardians, payments, planPrices, plans, students } from "@ooc/db";
import { and, eq, isNull, lt, lte, desc, sql } from "drizzle-orm";
import type { Db } from "@/infra/db/client.js";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export class DrizzlePublicEnrollmentRepository implements IPublicEnrollmentRepository {
  constructor(private readonly db: Db) {}

  async findContext(params: { classGroupId: string; planId: string }): Promise<PublicEnrollmentContext | null> {
    const [classGroupRow] = await this.db
      .select({ courseMinAge: courses.minAge })
      .from(classGroups)
      .innerJoin(courses, eq(courses.id, classGroups.courseId))
      .where(and(eq(classGroups.id, params.classGroupId), eq(classGroups.status, "enrolling")));

    if (!classGroupRow) {
      return null;
    }

    const [priceRow] = await this.db
      .select({ id: planPrices.id, amountCents: planPrices.amountCents })
      .from(planPrices)
      .innerJoin(plans, eq(plans.id, planPrices.planId))
      .where(and(eq(planPrices.planId, params.planId), lte(planPrices.validFrom, sql`now()`)))
      .orderBy(desc(planPrices.validFrom))
      .limit(1);

    if (!priceRow) {
      return null;
    }

    return {
      courseMinAge: classGroupRow.courseMinAge,
      planPriceId: priceRow.id,
      amountCents: priceRow.amountCents,
    };
  }

  async submit(params: SubmitPublicEnrollmentParams): Promise<SubmitPublicEnrollmentResult> {
    return this.db.transaction(async (tx) => {
      // Idempotency first (CLAUDE.md §5): a retry with the same key returns
      // what the first attempt already created instead of claiming a
      // second seat.
      const [existingPayment] = await tx
        .select()
        .from(payments)
        .where(eq(payments.idempotencyKey, params.payment.idempotencyKey));

      if (existingPayment) {
        return this.loadResult(tx, existingPayment.id);
      }

      // The same atomic instruction CLAUDE.md §5 requires — seat validation
      // never happens in application code, only in this WHERE clause.
      const [reservedSeat] = await tx
        .update(classGroups)
        .set({ seatsTaken: sql`${classGroups.seatsTaken} + 1` })
        .where(
          and(eq(classGroups.id, params.enrollment.classGroupId), lt(classGroups.seatsTaken, classGroups.capacity)),
        )
        .returning({ seatsTaken: classGroups.seatsTaken });

      if (!reservedSeat) {
        throw new ClassGroupFullError();
      }

      // One person, one record (CLAUDE.md §1): the document decides, not the
      // id the usecase proposed. A returning student re-typing their name with
      // a different accent, or a new e-mail, is the same human being — and a
      // second row here is what splits their history in two, since every
      // enrollment and payment hangs off whichever id was written that day.
      const [existingStudent] = await tx
        .select()
        .from(students)
        .where(
          and(
            eq(students.nationalIdType, params.student.nationalIdType),
            eq(students.nationalId, params.student.nationalId),
            // A retired record does not answer for the person any more
            // (CLAUDE.md §6 — soft delete is the only delete there is).
            isNull(students.deletedAt),
          ),
        )
        .limit(1);

      const [studentRow] = existingStudent
        ? // Contact details are refreshed, identity is not: the person just
          // told us their current e-mail, phone and city, and that is the
          // whole reason they could still receive the Classroom invite. Name,
          // document and birth date are left alone — correcting those is a
          // staff act with an audit trail, not a side effect of a checkout.
          await tx
            .update(students)
            .set({
              email: params.student.email,
              phone: params.student.phone,
              country: params.student.country,
              region: params.student.region,
              city: params.student.city,
              updatedAt: new Date(),
            })
            .where(eq(students.id, existingStudent.id))
            .returning()
        : await tx
            .insert(students)
            .values({
              id: params.student.id,
              firstName: params.student.firstName,
              lastName: params.student.lastName,
              nationalIdType: params.student.nationalIdType,
              nationalId: params.student.nationalId,
              email: params.student.email,
              phone: params.student.phone,
              birthDate: params.student.birthDate,
              country: params.student.country,
              region: params.student.region,
              city: params.student.city,
            })
            .returning();

      if (!studentRow) {
        throw new Error("Writing the student returned no row");
      }

      let guardianResult: Guardian | null = null;
      if (params.guardian) {
        // `guardians.student_id` is UNIQUE, so a returning minor cannot get a
        // second guardian row — and must not: the apoderado on file is the one
        // whose consent the institution holds. The record is updated in place
        // and the new acceptance is appended below, which is also how an
        // apoderado who changed (a mother enrolling this time, a father the
        // last) ends up on the record that the class group actually reads.
        const [existingGuardian] = await tx
          .select()
          .from(guardians)
          .where(eq(guardians.studentId, studentRow.id))
          .limit(1);

        const [guardianRow] = existingGuardian
          ? await tx
              .update(guardians)
              .set({
                firstName: params.guardian.firstName,
                lastName: params.guardian.lastName,
                relationship: params.guardian.relationship,
                nationalIdType: params.guardian.nationalIdType,
                nationalId: params.guardian.nationalId,
                email: params.guardian.email,
                phone: params.guardian.phone,
                updatedAt: new Date(),
              })
              .where(eq(guardians.id, existingGuardian.id))
              .returning()
          : await tx
              .insert(guardians)
              .values({
                id: params.guardian.id,
                studentId: studentRow.id,
                firstName: params.guardian.firstName,
                lastName: params.guardian.lastName,
                relationship: params.guardian.relationship,
                nationalIdType: params.guardian.nationalIdType,
                nationalId: params.guardian.nationalId,
                email: params.guardian.email,
                phone: params.guardian.phone,
              })
              .returning();

        if (!guardianRow) {
          throw new Error("Writing the guardian returned no row");
        }

        if (params.consent) {
          await tx.insert(consents).values({
            guardianId: guardianRow.id,
            version: params.consent.version,
            acceptedAt: params.consent.acceptedAt,
            ip: params.consent.ip,
          });
        }

        guardianResult = new Guardian({
          id: guardianRow.id,
          studentId: guardianRow.studentId,
          firstName: guardianRow.firstName,
          lastName: guardianRow.lastName,
          relationship: guardianRow.relationship as GuardianRelationship,
          nationalIdType: guardianRow.nationalIdType as NationalIdType,
          nationalId: guardianRow.nationalId,
          email: guardianRow.email,
          phone: guardianRow.phone,
        });
      }

      const [enrollmentRow] = await tx
        .insert(enrollments)
        .values({
          id: params.enrollment.id,
          studentId: studentRow.id,
          classGroupId: params.enrollment.classGroupId,
          planPriceId: params.enrollment.planPriceId,
          seatStatus: params.enrollment.seatStatus,
        })
        .returning();

      if (!enrollmentRow) {
        throw new Error("Insert into enrollments returned no row");
      }

      const [paymentRow] = await tx
        .insert(payments)
        .values({
          id: params.payment.id,
          enrollmentId: enrollmentRow.id,
          idempotencyKey: params.payment.idempotencyKey,
          status: params.payment.status,
          method: params.payment.method,
          methodDetail: params.payment.methodDetail,
          amountCents: params.payment.amountCents,
          operationNumber: params.payment.operationNumber,
        })
        .returning();

      if (!paymentRow) {
        throw new Error("Insert into payments returned no row");
      }

      return {
        student: new Student({
          id: studentRow.id,
          firstName: studentRow.firstName,
          lastName: studentRow.lastName,
          nationalIdType: studentRow.nationalIdType as NationalIdType,
          nationalId: studentRow.nationalId,
          email: studentRow.email,
          phone: studentRow.phone,
          birthDate: studentRow.birthDate,
          country: studentRow.country,
          region: studentRow.region,
          city: studentRow.city,
        }),
        guardian: guardianResult,
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

  /** Rehydrates the full result an earlier attempt already created, keyed
   * off the payment an idempotency retry just matched. */
  private async loadResult(tx: Tx, paymentId: string): Promise<SubmitPublicEnrollmentResult> {
    const [paymentRow] = await tx.select().from(payments).where(eq(payments.id, paymentId));
    if (!paymentRow) throw new Error("Payment vanished inside its own transaction");

    const [enrollmentRow] = await tx.select().from(enrollments).where(eq(enrollments.id, paymentRow.enrollmentId));
    if (!enrollmentRow) throw new Error("Enrollment vanished inside its own transaction");

    const [studentRow] = await tx.select().from(students).where(eq(students.id, enrollmentRow.studentId));
    if (!studentRow) throw new Error("Student vanished inside its own transaction");

    const [guardianRow] = await tx.select().from(guardians).where(eq(guardians.studentId, studentRow.id));

    return {
      student: new Student({
        id: studentRow.id,
        firstName: studentRow.firstName,
        lastName: studentRow.lastName,
        nationalIdType: studentRow.nationalIdType as NationalIdType,
        nationalId: studentRow.nationalId,
        email: studentRow.email,
        phone: studentRow.phone,
        birthDate: studentRow.birthDate,
        country: studentRow.country,
        region: studentRow.region,
        city: studentRow.city,
      }),
      guardian: guardianRow
        ? new Guardian({
            id: guardianRow.id,
            studentId: guardianRow.studentId,
            firstName: guardianRow.firstName,
            lastName: guardianRow.lastName,
            relationship: guardianRow.relationship as GuardianRelationship,
            nationalIdType: guardianRow.nationalIdType as NationalIdType,
            nationalId: guardianRow.nationalId,
            email: guardianRow.email,
            phone: guardianRow.phone,
          })
        : null,
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
  }
}
