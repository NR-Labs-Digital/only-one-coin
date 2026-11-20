import { monthlyAccessLock, type CoveredModule, type CoverageStatus } from "@ooc/domain";
import { classGroupModules, classGroups, enrollments, paymentModules, payments, planPrices, plans, students } from "@ooc/db";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import type { Db } from "@/infra/db/client.js";
import { enrollmentModuleId } from "./classGroupModuleSql.js";

/**
 * Where a monthly seat stands on the module it is on (OOC-86): `paid` — bought
 * and approved; `in_review` — bought, the receipt waiting for a person;
 * `due` — nobody bought it; `unknown` — the run has no module number, so
 * nothing says which module it is.
 */
export type MonthlySeatState = "paid" | "in_review" | "due" | "unknown";

export interface ClassGroupMonthlyRow {
  enrollmentId: string;
  studentId: string;
  firstName: string;
  lastName: string;
  classGroupModuleId: string;
  module: number | null;
  attempt: number;
  state: MonthlySeatState;
  /** When the seat entered the module it owes — null unless `due`. */
  dueSince: Date | null;
  /** Later modules already bought ahead, still alive, in order. */
  aheadModules: number[];
}

/**
 * The monthly seats of a class group and where each one stands (OOC-86): who
 * is up to date, who has a receipt in review, and who owes the module they are
 * on and since when. Confirmed seats of monthly plans only, every run of the
 * class group, surname order. Null when the class group does not exist.
 */
export class ClassGroupMonthlyQuery {
  constructor(private readonly db: Db) {}

  async run(classGroupId: string): Promise<ClassGroupMonthlyRow[] | null> {
    const [group] = await this.db.select({ id: classGroups.id }).from(classGroups).where(eq(classGroups.id, classGroupId));
    if (!group) return null;

    const seats = await this.db
      .select({
        enrollmentId: enrollments.id,
        studentId: students.id,
        firstName: students.firstName,
        lastName: students.lastName,
        classGroupModuleId: classGroupModules.id,
        module: classGroupModules.module,
        attempt: enrollments.moduleAttempt,
        enteredAt: enrollments.moduleEnteredAt,
      })
      .from(enrollments)
      .innerJoin(students, eq(students.id, enrollments.studentId))
      .innerJoin(classGroupModules, eq(classGroupModules.id, enrollmentModuleId()))
      .innerJoin(planPrices, eq(planPrices.id, enrollments.planPriceId))
      .innerJoin(plans, eq(plans.id, planPrices.planId))
      .where(
        and(
          eq(enrollments.classGroupId, classGroupId),
          eq(plans.billing, "monthly"),
          eq(enrollments.seatStatus, "confirmed"),
          isNull(enrollments.deletedAt),
        ),
      )
      .orderBy(asc(students.lastName), asc(students.firstName), asc(enrollments.id));
    if (seats.length === 0) return [];

    const bought = await this.db
      .select({
        enrollmentId: paymentModules.enrollmentId,
        module: paymentModules.module,
        attempt: paymentModules.attempt,
        status: payments.status,
      })
      .from(paymentModules)
      .innerJoin(payments, eq(payments.id, paymentModules.paymentId))
      .where(
        and(
          inArray(
            paymentModules.enrollmentId,
            seats.map((seat) => seat.enrollmentId),
          ),
          inArray(payments.status, ["pending", "under_review", "approved"]),
        ),
      );
    const byEnrollment = new Map<string, CoveredModule[]>();
    for (const row of bought) {
      const list = byEnrollment.get(row.enrollmentId) ?? [];
      list.push({ module: row.module, attempt: row.attempt, status: row.status as CoverageStatus });
      byEnrollment.set(row.enrollmentId, list);
    }

    return seats.map(({ enteredAt, ...seat }) => {
      const covered = byEnrollment.get(seat.enrollmentId) ?? [];
      if (seat.module === null) return { ...seat, state: "unknown", dueSince: null, aheadModules: [] };
      const lock = monthlyAccessLock({ module: seat.module, attempt: seat.attempt }, covered);
      const state: MonthlySeatState = lock === null ? "paid" : lock === "monthly_payment_in_review" ? "in_review" : "due";
      const current = seat.module;
      return {
        ...seat,
        state,
        dueSince: state === "due" ? enteredAt : null,
        aheadModules: [...new Set(covered.filter((item) => item.module > current).map((item) => item.module))].sort((a, b) => a - b),
      };
    });
  }
}
