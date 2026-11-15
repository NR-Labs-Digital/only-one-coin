import {
  EnrollmentMoveConflictError,
  type EnrollmentMoveSource,
  type EnrollmentMoveTarget,
  type IEnrollmentMoveRepository,
  type SeatStatus,
} from "@ooc/domain";
import { classGroupModules, classGroups, enrollments, plans } from "@ooc/db";
import { and, eq, isNull, ne, sql } from "drizzle-orm";
import type { Db } from "@/infra/db/client.js";
import { giveBackSeat } from "@/infra/persistence/catalog/seatCounters.js";
import { movableClassGroup } from "@/infra/persistence/catalog/sellableClassGroup.js";
import { takeManualSeat } from "./takeManualSeat.js";
import { enrollmentInModule, enrollmentModuleId } from "@/infra/persistence/catalog/classGroupModuleSql.js";

/**
 * Moving an enrollment between class groups (OOC-84), or between the module
 * runs of one (OOC-156). The seat counters move in the same transaction as
 * the enrollment row, and only through atomic UPDATEs — the target's room is
 * never read and compared in code (apps/api CLAUDE.md, Vagas). Within one
 * class group the seat stays: the seats are the class group's.
 */
export class DrizzleEnrollmentMoveRepository implements IEnrollmentMoveRepository {
  constructor(private readonly db: Db) {}

  async findSource(enrollmentId: string): Promise<EnrollmentMoveSource | null> {
    const [row] = await this.db
      .select({
        id: enrollments.id,
        studentId: enrollments.studentId,
        classGroupId: enrollments.classGroupId,
        classGroupModuleId: enrollmentModuleId(),
        courseId: classGroups.courseId,
        seatStatus: enrollments.seatStatus,
        // Graded on the attempt it is on now (OOC-156): a grade from a module
        // it already left, or from before it repeated, does not hold it.
        graded: sql<boolean>`exists (
          select 1 from "grades" g
           where g.enrollment_id = "enrollments"."id"
             and coalesce(g.class_group_module_id, g.class_group_id) = coalesce("enrollments"."class_group_module_id", "enrollments"."class_group_id")
             and g.attempt = "enrollments"."module_attempt"
        )`,
      })
      .from(enrollments)
      .innerJoin(classGroups, eq(classGroups.id, enrollments.classGroupId))
      .where(and(eq(enrollments.id, enrollmentId), isNull(enrollments.deletedAt)))
      .limit(1);
    return row ? { ...row, seatStatus: row.seatStatus as SeatStatus } : null;
  }

  async findTarget(classGroupModuleId: string): Promise<EnrollmentMoveTarget | null> {
    const [row] = await this.db
      .select({
        id: classGroupModules.id,
        classGroupId: classGroups.id,
        courseId: classGroups.courseId,
        open: sql<boolean>`${movableClassGroup()}`,
      })
      .from(classGroupModules)
      .innerJoin(classGroups, eq(classGroups.id, classGroupModules.classGroupId))
      .where(and(eq(classGroupModules.id, classGroupModuleId), isNull(classGroupModules.deletedAt)))
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
    fromClassGroupModuleId: string;
    toClassGroupId: string;
    toClassGroupModuleId: string;
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
            enrollmentInModule(params.fromClassGroupModuleId),
            ne(enrollments.seatStatus, "released"),
            isNull(enrollments.deletedAt),
          ),
        )
        .for("update");
      if (!current) throw new EnrollmentMoveConflictError();

      if (params.fromClassGroupId === params.toClassGroupId) {
        // Another run of the same class group: the seat is the class group's
        // and stays where it is — only the run changes. The run must still be
        // live and the class group still open, re-checked by the write.
        const [moved] = await tx
          .update(enrollments)
          .set({
            classGroupModuleId: params.toClassGroupModuleId,
            // A run it took before keeps its grades: this is the next attempt.
            moduleAttempt: sql`1 + (
            select count(*) from "grades" earlier
            where earlier.enrollment_id = ${params.enrollmentId}
              and coalesce(earlier.class_group_module_id, earlier.class_group_id) = ${params.toClassGroupModuleId}
          )`,
            updatedAt: sql`now()`,
          })
          .where(
            and(
              eq(enrollments.id, params.enrollmentId),
              sql`exists (
                select 1 from ${classGroupModules}
                join ${classGroups} on ${classGroups.id} = ${classGroupModules.classGroupId}
                where ${classGroupModules.id} = ${params.toClassGroupModuleId}
                  and ${classGroupModules.classGroupId} = ${params.toClassGroupId}
                  and ${classGroupModules.deletedAt} is null
                  and ${movableClassGroup()}
              )`,
            ),
          )
          .returning({ updatedAt: enrollments.updatedAt });
        if (!moved) throw new EnrollmentMoveConflictError();
        return { overCapacity: current.overCapacity, movedAt: moved.updatedAt };
      }

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
          classGroupModuleId: params.toClassGroupModuleId,
          moduleAttempt: sql`1 + (
          select count(*) from "grades" earlier
          where earlier.enrollment_id = ${params.enrollmentId}
            and coalesce(earlier.class_group_module_id, earlier.class_group_id) = ${params.toClassGroupModuleId}
          )`,
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
