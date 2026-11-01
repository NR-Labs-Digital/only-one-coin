import {
  Enrollment,
  Guardian,
  Payment,
  EmailVerificationRequiredError,
  ReceiptNotReadyError,
  SeatHoldExpiredError,
  Student,
  type EnrollmentOrigin,
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
import {
  classGroups,
  consents,
  courses,
  enrollments,
  guardians,
  payments,
  planPrices,
  plans,
  receiptUploads,
  seatHolds,
  students,
} from "@ooc/db";
import { and, eq, gt, inArray, isNull, lte, desc, sql } from "drizzle-orm";
import type { Db } from "@/infra/db/client.js";
import { insertOutboxEmails } from "@/infra/persistence/notification/DrizzleOutboxRepository.js";
import { consumeVerifiedEmail } from "./DrizzleEmailVerificationRepository.js";
import { assertOperationNumberUnused } from "./operationNumberGuard.js";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export class DrizzlePublicEnrollmentRepository implements IPublicEnrollmentRepository {
  constructor(private readonly db: Db) {}

  async findContext(params: { classGroupId: string; planId: string }): Promise<PublicEnrollmentContext | null> {
    const [classGroupRow] = await this.db
      .select({ courseMinAge: courses.minAge, courseName: courses.name, classGroupStartsOn: classGroups.startsOn })
      .from(classGroups)
      .innerJoin(courses, eq(courses.id, classGroups.courseId))
      // A retired class group or course is not on offer any more, the same
      // way a closed one is not (CLAUDE.md §6).
      .where(
        and(
          eq(classGroups.id, params.classGroupId),
          eq(classGroups.status, "enrolling"),
          isNull(classGroups.deletedAt),
          isNull(courses.deletedAt),
        ),
      );

    if (!classGroupRow) {
      return null;
    }

    const [priceRow] = await this.db
      .select({ id: planPrices.id, amountCents: planPrices.amountCents })
      .from(planPrices)
      .innerJoin(plans, eq(plans.id, planPrices.planId))
      .where(
        and(
          eq(planPrices.planId, params.planId),
          lte(planPrices.validFrom, sql`now()`),
          isNull(plans.deletedAt),
        ),
      )
      .orderBy(desc(planPrices.validFrom))
      .limit(1);

    if (!priceRow) {
      return null;
    }

    return {
      courseMinAge: classGroupRow.courseMinAge,
      planPriceId: priceRow.id,
      amountCents: priceRow.amountCents,
      courseName: classGroupRow.courseName,
      // Never null here: the query above only matches status = 'enrolling', and the 0018 check forbids a non-draft without dates.
      classGroupStartsOn: classGroupRow.classGroupStartsOn!,
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

      // The seat was taken when the hold was claimed (DrizzleSeatHoldRepository
      // .claim, the atomic `seats_taken + 1` of apps/api/CLAUDE.md). Here it
      // only changes hands: the hold must still be alive on the database
      // clock, and FOR UPDATE keeps the expiry sweep off it until this
      // transaction ends — the sweep skips locked rows, so a submit that got
      // here first is never undercut by a seat handed back underneath it.
      const [liveHold] = await tx
        .select({ id: seatHolds.id })
        .from(seatHolds)
        .where(
          and(
            eq(seatHolds.id, params.seatHoldId),
            eq(seatHolds.classGroupId, params.enrollment.classGroupId),
            eq(seatHolds.status, "active"),
            gt(seatHolds.expiresAt, sql`now()`),
          ),
        )
        .for("update");

      if (!liveHold) {
        throw new SeatHoldExpiredError();
      }

      // The authoritative check, same reasoning as the hold above: the
      // usecase already looked once, this is the one inside the transaction
      // that actually decides. FOR UPDATE keeps a racing confirm or the
      // normalize worker's own write off this row until the transaction ends.
      const [receiptRow] = await tx
        .select({ id: receiptUploads.id })
        .from(receiptUploads)
        .where(
          and(
            eq(receiptUploads.id, params.receiptUploadId),
            eq(receiptUploads.seatHoldId, params.seatHoldId),
            inArray(receiptUploads.status, ["uploaded", "processed"]),
          ),
        )
        .for("update");

      if (!receiptRow) {
        throw new ReceiptNotReadyError();
      }

      // The student's e-mail must have been proven on this same checkout
      // (spec 2026-10-07). Consumed here, inside the submit's transaction, so
      // one proof becomes at most one enrollment — and a refused submit rolls
      // the consumption back with everything else. `params.student.email` is
      // already normalized by Student.create.
      if (!(await consumeVerifiedEmail(tx, { seatHoldId: liveHold.id, email: params.student.email }))) {
        throw new EmailVerificationRequiredError();
      }

      // Before any write: a refused operation number leaves the hold, the
      // student and everything else exactly as they were (OOC-22).
      await assertOperationNumberUnused(tx, {
        method: params.payment.method,
        operationNumber: params.payment.operationNumber ?? "",
      });

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
              // The flag is about the address that bounced: a new one starts clean.
              emailInvalidAt: sql`case when lower(${students.email}) = lower(${params.student.email}) then ${students.emailInvalidAt} else null end`,
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
                // Revived, not duplicated: `guardians.student_id` is UNIQUE
                // across retired rows too, and a student enrolling right now
                // does have an apoderado on file — this one (CLAUDE.md §6).
                deletedAt: null,
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
          origin: params.enrollment.origin,
        })
        .returning();

      if (!enrollmentRow) {
        throw new Error("Insert into enrollments returned no row");
      }

      await tx
        .update(seatHolds)
        .set({ status: "consumed", enrollmentId: enrollmentRow.id, settledAt: sql`now()`, updatedAt: sql`now()` })
        .where(eq(seatHolds.id, liveHold.id));

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

      // Filled the moment the payment exists — same moment `seat_holds.
      // enrollment_id` is filled above.
      await tx
        .update(receiptUploads)
        .set({ paymentId: paymentRow.id, updatedAt: sql`now()` })
        .where(eq(receiptUploads.id, receiptRow.id));

      // Same transaction as everything above: the "enrollment received"
      // e-mail exists exactly when the enrollment does. The idempotent-retry
      // branch at the top returns before this, so a retry queues nothing new.
      await insertOutboxEmails(tx, params.notifications);

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
          origin: enrollmentRow.origin as EnrollmentOrigin,
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
        origin: enrollmentRow.origin as EnrollmentOrigin,
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
