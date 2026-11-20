import {
  Enrollment,
  Payment,
  ReceiptNotReadyError,
  SeatHoldExpiredError,
  Student,
  type EnrollmentOrigin,
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
  paymentLotEnrollments,
  payments,
  planPrices,
  plans,
  receiptUploads,
  seatHolds,
  students,
} from "@ooc/db";
import { and, asc, eq, inArray, isNull, lte, desc, sql } from "drizzle-orm";
import type { Db } from "@/infra/db/client.js";
import { insertOutboxEmails } from "@/infra/persistence/notification/DrizzleOutboxRepository.js";
import { assertOperationNumberUnused } from "./operationNumberGuard.js";
import { seatForExpiredHold } from "./classGroupOffer.js";
import { entryModuleIdOf } from "@/infra/persistence/catalog/classGroupModuleSql.js";
import { recordMonthlyEntryModules } from "@/infra/persistence/payment/monthlyEntryModule.js";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export class DrizzlePublicEnrollmentRepository implements IPublicEnrollmentRepository {
  constructor(private readonly db: Db) {}

  async findContext(params: { classGroupId: string; planId: string }): Promise<PublicEnrollmentContext | null> {
    const [classGroupRow] = await this.db
      .select({
        courseId: courses.id,
        courseMinAge: courses.minAge,
        courseName: courses.name,
        classGroupStartsOn: classGroups.startsOn,
      })
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
      courseId: classGroupRow.courseId,
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
        .select({ id: payments.id })
        .from(payments)
        .where(eq(payments.idempotencyKey, params.payment.idempotencyKey));

      if (existingPayment) {
        return this.loadResult(tx, existingPayment.id);
      }

      // The seats were taken when the holds were claimed (DrizzleSeatHoldRepository
      // .claim, the atomic `seats_taken + 1` of apps/api/CLAUDE.md). Here they
      // only change hands. FOR UPDATE keeps the expiry sweep off each hold
      // until this transaction ends — the sweep skips locked rows, so a submit
      // that got here first is never undercut by a seat handed back
      // underneath it. A lot (OOC-158) locks its holds in id order, so two
      // submits naming the same holds queue instead of deadlocking.
      //
      // A hold whose clock ran out still counts (OOC-155, owner's decision of
      // 14/11/2026: any expired hold, no window): the person paid with the
      // seat in hand. Still `active` (the sweep has not passed), its seat is
      // still counted and simply changes hands. Already `expired`, its seat
      // went back, so it is taken again — a regular one if the schedule has
      // room, above capacity if not (seatForExpiredHold). A `released` hold
      // was let go by the checkout itself (it picked another class group) and
      // is not a reservation any more.
      const holds = new Map<string, { classGroupId: string; status: string }>();
      for (const item of [...params.items].sort((a, b) => a.seatHoldId.localeCompare(b.seatHoldId))) {
        const [hold] = await tx
          .select({ id: seatHolds.id, classGroupId: seatHolds.classGroupId, status: seatHolds.status })
          .from(seatHolds)
          .where(
            and(
              eq(seatHolds.id, item.seatHoldId),
              eq(seatHolds.classGroupId, item.enrollment.classGroupId),
              inArray(seatHolds.status, ["active", "expired"]),
            ),
          )
          .for("update");

        if (!hold) {
          throw new SeatHoldExpiredError();
        }
        holds.set(hold.id, hold);
      }

      const lead = params.items[0];
      if (!lead) throw new Error("A submit needs at least one item");

      // The authoritative check, same reasoning as the holds above: the
      // usecase already looked once, this is the one inside the transaction
      // that actually decides. FOR UPDATE keeps a racing confirm or the
      // normalize worker's own write off this row until the transaction ends.
      // The receipt was uploaded against the lot's first hold.
      const [receiptRow] = await tx
        .select({ id: receiptUploads.id })
        .from(receiptUploads)
        .where(
          and(
            eq(receiptUploads.id, params.receiptUploadId),
            eq(receiptUploads.seatHoldId, lead.seatHoldId),
            inArray(receiptUploads.status, ["uploaded", "processed"]),
          ),
        )
        .for("update");

      if (!receiptRow) {
        throw new ReceiptNotReadyError();
      }

      // Before any write: a refused operation number leaves the holds, the
      // students and everything else exactly as they were (OOC-22). One
      // receipt, one operation — checked once for the whole lot.
      await assertOperationNumberUnused(tx, {
        method: params.payment.method,
        operationNumber: params.payment.operationNumber ?? "",
      });

      // After every check that can refuse the submit, so a refusal never
      // takes a seat it would have to give back. In lot order: two expired
      // holds of the same schedule take the regular seats left one by one.
      const seats: { classGroupId: string; overCapacity: boolean }[] = [];
      for (const item of params.items) {
        const hold = holds.get(item.seatHoldId)!;
        const seat =
          hold.status === "active"
            ? { classGroupId: hold.classGroupId, overCapacity: false }
            : await seatForExpiredHold(tx, hold.classGroupId);
        if (!seat) {
          throw new SeatHoldExpiredError();
        }
        seats.push(seat);
      }

      const students: Student[] = [];
      for (const person of params.people) {
        students.push(await this.writePerson(tx, person, params.consent));
      }

      const enrollmentRows: (typeof enrollments.$inferSelect)[] = [];
      for (const [index, item] of params.items.entries()) {
        const seat = seats[index]!;
        const [enrollmentRow] = await tx
          .insert(enrollments)
          .values({
            id: item.enrollment.id,
            // The resolved person, never the id the usecase proposed.
            studentId: students[item.person]!.id,
            // The class group the seat is actually on: a sibling of the hold's
            // when an expired hold was seated again.
            classGroupId: seat.classGroupId,
            // A new student starts in the class group's entry run (OOC-156).
            classGroupModuleId: entryModuleIdOf(seat.classGroupId),
            planPriceId: item.enrollment.planPriceId,
            seatStatus: item.enrollment.seatStatus,
            origin: item.enrollment.origin,
            overCapacity: seat.overCapacity,
          })
          .returning();

        if (!enrollmentRow) {
          throw new Error("Insert into enrollments returned no row");
        }
        enrollmentRows.push(enrollmentRow);

        await tx
          .update(seatHolds)
          .set({ status: "consumed", enrollmentId: enrollmentRow.id, settledAt: sql`now()`, updatedAt: sql`now()` })
          .where(eq(seatHolds.id, item.seatHoldId));
      }

      const [paymentRow] = await tx
        .insert(payments)
        .values({
          id: params.payment.id,
          // The lot's first item; the others are listed below.
          enrollmentId: enrollmentRows[0]!.id,
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

      // A lot (OOC-158): the same payment pays for every other item too. One
      // statement, in lot order — the ids are time-ordered, which is the
      // order the lot reads back in.
      const others = enrollmentRows.slice(1);
      if (others.length > 0) {
        await tx
          .insert(paymentLotEnrollments)
          .values(others.map((row) => ({ paymentId: paymentRow.id, enrollmentId: row.id })));
      }

      // A monthly item's payment buys the module the student enters (OOC-86).
      await recordMonthlyEntryModules(
        tx,
        paymentRow.id,
        enrollmentRows.map((row) => row.id),
      );

      // Filled the moment the payment exists — same moment `seat_holds.
      // enrollment_id` is filled above.
      await tx
        .update(receiptUploads)
        .set({ paymentId: paymentRow.id, updatedAt: sql`now()` })
        .where(eq(receiptUploads.id, receiptRow.id));

      // Same transaction as everything above: the "enrollment received"
      // e-mail exists exactly when the enrollments do. The idempotent-retry
      // branch at the top returns before this, so a retry queues nothing new.
      await insertOutboxEmails(tx, params.notifications);

      return {
        students,
        enrollments: enrollmentRows.map(toEnrollment),
        payment: toPayment(paymentRow, enrollmentRows[0]!.id),
      };
    });
  }

  /**
   * One person of the checkout, and their guardian.
   *
   * One person, one record (CLAUDE.md §1): the document decides, not the id
   * the usecase proposed. A returning student re-typing their name with a
   * different accent, or a new e-mail, is the same human being — and a second
   * row here is what splits their history in two, since every enrollment and
   * payment hangs off whichever id was written that day.
   */
  private async writePerson(
    tx: Tx,
    person: SubmitPublicEnrollmentParams["people"][number],
    consent: SubmitPublicEnrollmentParams["consent"],
  ): Promise<Student> {
    const [existingStudent] = await tx
      .select()
      .from(students)
      .where(
        and(
          eq(students.nationalIdType, person.student.nationalIdType),
          eq(students.nationalId, person.student.nationalId),
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
            email: person.student.email,
            // The flag is about the address that bounced: a new one starts clean.
            emailInvalidAt: sql`case when lower(${students.email}) = lower(${person.student.email}) then ${students.emailInvalidAt} else null end`,
            phone: person.student.phone,
            country: person.student.country,
            region: person.student.region,
            city: person.student.city,
            updatedAt: new Date(),
          })
          .where(eq(students.id, existingStudent.id))
          .returning()
      : await tx
          .insert(students)
          .values({
            id: person.student.id,
            firstName: person.student.firstName,
            lastName: person.student.lastName,
            nationalIdType: person.student.nationalIdType,
            nationalId: person.student.nationalId,
            email: person.student.email,
            phone: person.student.phone,
            birthDate: person.student.birthDate,
            country: person.student.country,
            region: person.student.region,
            city: person.student.city,
          })
          .returning();

    if (!studentRow) {
      throw new Error("Writing the student returned no row");
    }

    if (person.guardian) {
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
              firstName: person.guardian.firstName,
              lastName: person.guardian.lastName,
              relationship: person.guardian.relationship,
              nationalIdType: person.guardian.nationalIdType,
              nationalId: person.guardian.nationalId,
              email: person.guardian.email,
              phone: person.guardian.phone,
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
              id: person.guardian.id,
              studentId: studentRow.id,
              firstName: person.guardian.firstName,
              lastName: person.guardian.lastName,
              relationship: person.guardian.relationship,
              nationalIdType: person.guardian.nationalIdType,
              nationalId: person.guardian.nationalId,
              email: person.guardian.email,
              phone: person.guardian.phone,
            })
            .returning();

      if (!guardianRow) {
        throw new Error("Writing the guardian returned no row");
      }

      if (consent) {
        await tx.insert(consents).values({
          guardianId: guardianRow.id,
          version: consent.version,
          acceptedAt: consent.acceptedAt,
          ip: consent.ip,
        });
      }
    }

    return toStudent(studentRow);
  }

  /** Rehydrates the result an earlier attempt already created, keyed off the
   * payment an idempotency retry just matched — the lot included. */
  private async loadResult(tx: Tx, paymentId: string): Promise<SubmitPublicEnrollmentResult> {
    const [paymentRow] = await tx.select().from(payments).where(eq(payments.id, paymentId));
    if (!paymentRow) throw new Error("Payment vanished inside its own transaction");
    // A key already spent on a procedure's payment (OOC-83): keys are minted by
    // the client, so only a forged one lands here, and it gets nothing back.
    if (!paymentRow.enrollmentId) throw new Error("Idempotency key belongs to a payment with no enrollment");

    const lot = await tx
      .select({ enrollmentId: paymentLotEnrollments.enrollmentId })
      .from(paymentLotEnrollments)
      .where(eq(paymentLotEnrollments.paymentId, paymentRow.id))
      .orderBy(asc(paymentLotEnrollments.id));
    const enrollmentIds = [paymentRow.enrollmentId, ...lot.map((row) => row.enrollmentId)];

    const enrollmentRows = await tx.select().from(enrollments).where(inArray(enrollments.id, enrollmentIds));
    const ordered = enrollmentIds.map((id) => {
      const row = enrollmentRows.find((candidate) => candidate.id === id);
      if (!row) throw new Error("Enrollment vanished inside its own transaction");
      return row;
    });

    const studentIds = [...new Set(ordered.map((row) => row.studentId))];
    const studentRows = await tx.select().from(students).where(inArray(students.id, studentIds));

    return {
      students: studentIds.map((id) => toStudent(studentRows.find((row) => row.id === id)!)),
      enrollments: ordered.map(toEnrollment),
      payment: toPayment(paymentRow, paymentRow.enrollmentId),
    };
  }
}

function toStudent(row: typeof students.$inferSelect): Student {
  return new Student({
    id: row.id,
    firstName: row.firstName,
    lastName: row.lastName,
    nationalIdType: row.nationalIdType as NationalIdType,
    nationalId: row.nationalId,
    email: row.email,
    phone: row.phone,
    birthDate: row.birthDate,
    country: row.country,
    region: row.region,
    city: row.city,
  });
}

function toEnrollment(row: typeof enrollments.$inferSelect): Enrollment {
  return new Enrollment({
    id: row.id,
    studentId: row.studentId,
    classGroupId: row.classGroupId,
    planPriceId: row.planPriceId,
    seatStatus: row.seatStatus as SeatStatus,
    origin: row.origin as EnrollmentOrigin,
    overCapacity: row.overCapacity,
  });
}

function toPayment(row: typeof payments.$inferSelect, enrollmentId: string): Payment {
  return new Payment({
    id: row.id,
    enrollmentId,
    idempotencyKey: row.idempotencyKey,
    status: row.status as PaymentStatus,
    method: row.method as PaymentMethod,
    methodDetail: row.methodDetail,
    amountCents: row.amountCents,
    operationNumber: row.operationNumber,
  });
}
