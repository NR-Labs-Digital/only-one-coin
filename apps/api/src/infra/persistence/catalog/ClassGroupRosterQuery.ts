import { classGroups, enrollments, paymentCoverage, payments, planPrices, plans, students } from "@ooc/db";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import type { Db } from "@/infra/db/client.js";
import { academicStatusOf, type AcademicStatus } from "@ooc/domain";

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
  /** OOC-84: active, frozen or completed — derived, never stored. */
  academicStatus: AcademicStatus;
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

  /**
   * `includeFrozen` (OOC-84) adds the seats frozen out of this class group:
   * coordination sees who paused here. The teacher's roster never asks — a
   * frozen student has no class to attend.
   */
  async run(classGroupId: string, options: { includeFrozen?: boolean } = {}): Promise<ClassGroupRosterRow[] | null> {
    const [group] = await this.db
      .select({ id: classGroups.id, status: classGroups.status })
      .from(classGroups)
      .where(eq(classGroups.id, classGroupId));
    if (!group) return null;

    // The payment that speaks for the enrollment is the most recent one — a
    // monthly enrollment writes one per module (CLAUDE.md §1), and the roster
    // is about where the seat stands now. Same choice as the ledger.
    const latestPayment = this.db
      .selectDistinctOn([paymentCoverage.enrollmentId], {
        enrollmentId: paymentCoverage.enrollmentId,
        status: payments.status,
      })
      // Every enrollment a payment pays for, a lot's included (OOC-158).
      .from(paymentCoverage)
      .innerJoin(payments, eq(payments.id, paymentCoverage.paymentId))
      .orderBy(paymentCoverage.enrollmentId, desc(payments.createdAt))
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
        seatStatus: enrollments.seatStatus,
      })
      .from(enrollments)
      .innerJoin(students, eq(students.id, enrollments.studentId))
      .innerJoin(planPrices, eq(planPrices.id, enrollments.planPriceId))
      .innerJoin(plans, eq(plans.id, planPrices.planId))
      .leftJoin(latestPayment, eq(latestPayment.enrollmentId, enrollments.id))
      .where(
        and(
          eq(enrollments.classGroupId, classGroupId),
          options.includeFrozen
            ? inArray(enrollments.seatStatus, ["confirmed", "frozen"])
            : eq(enrollments.seatStatus, "confirmed"),
          isNull(enrollments.deletedAt),
        ),
      )
      .orderBy(asc(students.lastName), asc(students.firstName), asc(enrollments.id));

    return rows.map(({ seatStatus, ...row }) => ({
      ...row,
      paymentStatus: row.paymentStatus as RosterPaymentStatus | null,
      // Confirmed or frozen by the filter above, so never null here.
      academicStatus: academicStatusOf(seatStatus, group.status) ?? "active",
    }));
  }
}
