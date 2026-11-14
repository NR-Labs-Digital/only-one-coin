import {
  EnrollmentMoveConflictError,
  type EnrollmentMoveSource,
  type EnrollmentMoveTarget,
  type IEnrollmentMoveRepository,
  type SeatStatus,
} from "@ooc/domain";
import { classGroups, enrollments, grades, plans } from "@ooc/db";
import { and, eq, isNull, ne, sql } from "drizzle-orm";
import type { Db } from "@/infra/db/client.js";
import { giveBackSeat } from "@/infra/persistence/catalog/seatCounters.js";
import { movableClassGroup } from "@/infra/persistence/catalog/sellableClassGroup.js";
import { takeManualSeat } from "./takeManualSeat.js";

/**
 * Moving an enrollment between class groups (OOC-84). The seat counters move
 * in the same transaction as the enrollment row, and only through atomic
 * UPDATEs — the target's room is never read and compared in code (apps/api
 * CLAUDE.md, Vagas).
 */
export class DrizzleEnrollmentMoveRepository implements IEnrollmentMoveRepository {
  constructor(private readonly db: Db) {}

  async findSource(enrollmentId: string): Promise<EnrollmentMoveSource | null> {
    const [row] = await this.db
      .select({
        id: enrollments.id,
        studentId: enrollments.studentId,
        classGroupId: enrollments.classGroupId,
        courseId: classGroups.courseId,
        seatStatus: enrollments.seatStatus,
        graded: sql<boolean>`exists (
          select 1 from ${grades} g
           where g.enrollment_id = ${enrollments.id} and g.class_group_id = ${enrollments.classGroupId}
        )`,
      })
      .from(enrollments)
      .innerJoin(classGroups, eq(classGroups.id, enrollments.classGroupId))
      .where(and(eq(enrollments.id, enrollmentId), isNull(enrollments.deletedAt)))
      .limit(1);
    return row ? { ...row, seatStatus: row.seatStatus as SeatStatus } : null;
  }

  async findTarget(classGroupId: string): Promise<EnrollmentMoveTarget | null> {
    const [row] = await this.db
      .select({
        id: classGroups.id,
        courseId: classGroups.courseId,
        open: sql<boolean>`${movableClassGroup()}`,
      })
      .from(classGroups)
      .where(eq(classGroups.id, classGroupId))
      .limit(1);
    return row ?? null;
  }

  async findPlanCourse(planId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ courseId: plans.courseId })
      .from(plans)
      .where(and(eq(plans.id, planId), isNull(plans.deletedAt)))
      .limit(1);
    return row?.courseId ?? null;
  }

  async move(params: {
    enrollmentId: string;
    fromClassGroupId: string;
    toClassGroupId: string;
    planPriceId: string | null;
    allowOverCapacity: boolean;
  }): Promise<{ overCapacity: boolean; movedAt: Date }> {
    return this.db.transaction(async (tx) => {
      // Locked first and re-checked: a rejection in Pagos (which releases the
      // seat) or another move racing this one waits here, and whoever comes
      // second sees what the first did.
      const [current] = await tx
        .select({ overCapacity: enrollments.overCapacity })
        .from(enrollments)
        .where(
          and(
            eq(enrollments.id, params.enrollmentId),
            eq(enrollments.classGroupId, params.fromClassGroupId),
            ne(enrollments.seatStatus, "released"),
            isNull(enrollments.deletedAt),
          ),
        )
        .for("update");
      if (!current) throw new EnrollmentMoveConflictError();

      // Both class groups in id order, so two moves crossing between the same
      // pair lock in the same order and never deadlock.
      const take = () =>
        takeManualSeat(tx, {
          classGroupId: params.toClassGroupId,
          allowOverCapacity: params.allowOverCapacity,
          where: movableClassGroup(),
        });
      const giveBack = () =>
        giveBackSeat(tx, { classGroupId: params.fromClassGroupId, overCapacity: current.overCapacity });

      let overCapacity: boolean;
      if (params.fromClassGroupId < params.toClassGroupId) {
        await giveBack();
        overCapacity = await take();
      } else {
        overCapacity = await take();
        await giveBack();
      }

      const [moved] = await tx
        .update(enrollments)
        .set({
          classGroupId: params.toClassGroupId,
          overCapacity,
          ...(params.planPriceId ? { planPriceId: params.planPriceId } : {}),
          updatedAt: sql`now()`,
        })
        .where(eq(enrollments.id, params.enrollmentId))
        .returning({ updatedAt: enrollments.updatedAt });

      return { overCapacity, movedAt: moved!.updatedAt };
    });
  }
}
