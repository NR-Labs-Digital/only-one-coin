import { classGroups, enrollments, payments, planPrices, plans, students } from "@ooc/db";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import type { Db } from "@/infra/db/client.js";

export type RosterPaymentStatus = "pending" | "under_review" | "approved" | "rejected";

export interface ClassGroupRosterRow {
  enrollmentId: string;
  studentId: string;
  firstName: string;
  lastName: string;
  nationalIdType: string;
  nationalId: string;
  email: string;
  phone: string;
  planName: string;
  /** The most recent payment of the enrollment; null for a seat confirmed without one (seed, legacy import). */
  paymentStatus: RosterPaymentStatus | null;
}

/**
 * Who is enrolled in one class group: the confirmed seats, with the student
 * and where their money stands. Read-only shaping, so it lives beside the
 * repositories and not in the domain.
 *
 * Confirmed only, the ledger's rule (OOC-55): a seat still reserved is a
 * payment open in Pagos, and a released one is a refusal. The row carries
 * every column any reader may see; which ones leave the API depends on the
 * reader's role and is decided by the route, not here.
 *
 * `null` means the class group does not exist — a retired one still answers,
 * the same as `GET /catalog/class-groups/:id`.
 */
export class ClassGroupRosterQuery {
  constructor(private readonly db: Db) {}

  async run(classGroupId: string): Promise<ClassGroupRosterRow[] | null> {
    const [group] = await this.db
      .select({ id: classGroups.id })
      .from(classGroups)
      .where(eq(classGroups.id, classGroupId));
    if (!group) return null;

    // The payment that speaks for the enrollment is the most recent one — a
    // monthly enrollment writes one per module (CLAUDE.md §1), and the roster
    // is about where the seat stands now. Same choice as the ledger.
    const latestPayment = this.db
      .selectDistinctOn([payments.enrollmentId], {
        enrollmentId: payments.enrollmentId,
        status: payments.status,
      })
      .from(payments)
      .orderBy(payments.enrollmentId, desc(payments.createdAt))
      .as("latest_payment");

    const rows = await this.db
      .select({
        enrollmentId: enrollments.id,
        studentId: students.id,
        firstName: students.firstName,
        lastName: students.lastName,
        nationalIdType: students.nationalIdType,
        nationalId: students.nationalId,
        email: students.email,
        phone: students.phone,
        planName: plans.name,
        paymentStatus: latestPayment.status,
      })
      .from(enrollments)
      .innerJoin(students, eq(students.id, enrollments.studentId))
      .innerJoin(planPrices, eq(planPrices.id, enrollments.planPriceId))
      .innerJoin(plans, eq(plans.id, planPrices.planId))
      .leftJoin(latestPayment, eq(latestPayment.enrollmentId, enrollments.id))
      .where(
        and(
          eq(enrollments.classGroupId, classGroupId),
          eq(enrollments.seatStatus, "confirmed"),
          isNull(enrollments.deletedAt),
        ),
      )
      .orderBy(asc(students.lastName), asc(students.firstName), asc(enrollments.id));

    return rows.map((row) => ({ ...row, paymentStatus: row.paymentStatus as RosterPaymentStatus | null }));
  }
}
