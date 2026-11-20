import {
  EnrollmentFreezeConflictError,
  type FreezeSource,
  type IEnrollmentFreezeRepository,
  type LiveFreeze,
  type ReturnRun,
} from "@ooc/domain";
import {
  auditLog,
  classGroupModules,
  classGroups,
  courses,
  enrollmentFreezeReturns,
  enrollmentFreezes,
  enrollments,
  planPrices,
  plans,
} from "@ooc/db";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "@/infra/db/client.js";
import { giveBackSeat } from "@/infra/persistence/catalog/seatCounters.js";
import { movableClassGroup } from "@/infra/persistence/catalog/sellableClassGroup.js";
import { enrollmentInModule, enrollmentModuleId } from "@/infra/persistence/catalog/classGroupModuleSql.js";
import { takeManualSeatInOrder } from "./takeManualSeat.js";

/**
 * Freezing an enrollment and bringing it back (OOC-84). The seat counters move
 * in the same transaction as the enrollment row, through atomic UPDATEs only
 * (apps/api CLAUDE.md, Vagas): freezing gives the seat back to the counter it
 * held, coming back takes one in the run's class group — above capacity only
 * when staff said so.
 */
export class DrizzleEnrollmentFreezeRepository implements IEnrollmentFreezeRepository {
  constructor(private readonly db: Db) {}

  async findSource(enrollmentId: string): Promise<FreezeSource | null> {
    const [row] = await this.db
      .select({
        id: enrollments.id,
        studentId: enrollments.studentId,
        seatStatus: enrollments.seatStatus,
        classGroupId: enrollments.classGroupId,
        classGroupStatus: classGroups.status,
        classGroupModuleId: classGroupModules.id,
        module: classGroupModules.module,
        attempt: enrollments.moduleAttempt,
        courseAllowsFreeze: courses.allowsFreeze,
      })
      .from(enrollments)
      .innerJoin(classGroups, eq(classGroups.id, enrollments.classGroupId))
      .innerJoin(classGroupModules, eq(classGroupModules.id, enrollmentModuleId()))
      .innerJoin(courses, eq(courses.id, classGroups.courseId))
      .where(and(eq(enrollments.id, enrollmentId), isNull(enrollments.deletedAt)))
      .limit(1);
    return row ?? null;
  }

  async freeze(params: Parameters<IEnrollmentFreezeRepository["freeze"]>[0]): Promise<{ freezeId: string }> {
    const { source } = params;
    return this.db.transaction(async (tx) => {
      // Locked and re-checked: a move, a rejection in Pagos or another freeze
      // racing this one waits here, and whoever comes second sees the first.
      const [current] = await tx
        .select({ overCapacity: enrollments.overCapacity })
        .from(enrollments)
        .where(
          and(
            eq(enrollments.id, source.id),
            eq(enrollments.classGroupId, source.classGroupId),
            enrollmentInModule(source.classGroupModuleId),
            eq(enrollments.moduleAttempt, source.attempt),
            eq(enrollments.seatStatus, "confirmed"),
            isNull(enrollments.deletedAt),
          ),
        )
        .for("update");
      if (!current) throw new EnrollmentFreezeConflictError();

      await giveBackSeat(tx, { classGroupId: source.classGroupId, overCapacity: current.overCapacity });
      await tx
        .update(enrollments)
        .set({ seatStatus: "frozen", overCapacity: false, updatedAt: sql`now()` })
        .where(eq(enrollments.id, source.id));

      const [freeze] = await tx
        .insert(enrollmentFreezes)
        .values({
          enrollmentId: source.id,
          classGroupId: source.classGroupId,
          classGroupModuleId: source.classGroupModuleId,
          module: source.module,
          attempt: source.attempt,
          frozenBy: params.frozenBy,
          reason: params.reason,
        })
        .returning({ id: enrollmentFreezes.id });
      if (!freeze) throw new Error("Insert into enrollment_freezes returned no row");

      await tx.insert(auditLog).values({
        actorId: params.audit.actorId,
        action: params.audit.action,
        targetId: source.id,
        metadata: { ...params.audit.metadata, freezeId: freeze.id },
        createdAt: params.audit.at,
      });
      return { freezeId: freeze.id };
    });
  }

  async findLiveFreeze(enrollmentId: string): Promise<LiveFreeze | null> {
    const [row] = await this.db
      .select({
        freezeId: enrollmentFreezes.id,
        enrollmentId: enrollments.id,
        studentId: enrollments.studentId,
        courseId: plans.courseId,
        module: enrollmentFreezes.module,
        attempt: enrollmentFreezes.attempt,
      })
      .from(enrollmentFreezes)
      .innerJoin(enrollments, eq(enrollments.id, enrollmentFreezes.enrollmentId))
      // The course is the plan's: the enrollment's price says what it bought.
      .innerJoin(planPrices, eq(planPrices.id, enrollments.planPriceId))
      .innerJoin(plans, eq(plans.id, planPrices.planId))
      .where(
        and(
          eq(enrollmentFreezes.enrollmentId, enrollmentId),
          eq(enrollments.seatStatus, "frozen"),
          isNull(enrollments.deletedAt),
          sql`not exists (select 1 from ${enrollmentFreezeReturns} r where r.freeze_id = ${enrollmentFreezes.id})`,
        ),
      )
      .orderBy(desc(enrollmentFreezes.createdAt), desc(enrollmentFreezes.id))
      .limit(1);
    return row ?? null;
  }

  async findRun(classGroupModuleId: string): Promise<ReturnRun | null> {
    const [row] = await this.db
      .select(runColumns)
      .from(classGroupModules)
      .innerJoin(classGroups, eq(classGroups.id, classGroupModules.classGroupId))
      .where(and(eq(classGroupModules.id, classGroupModuleId), isNull(classGroupModules.deletedAt)))
      .limit(1);
    return row ?? null;
  }

  async listReturnRuns(params: { courseId: string; module: number | null }): Promise<ReturnRun[]> {
    return this.db
      .select(runColumns)
      .from(classGroupModules)
      .innerJoin(classGroups, eq(classGroups.id, classGroupModules.classGroupId))
      .where(
        and(
          eq(classGroups.courseId, params.courseId),
          params.module === null ? isNull(classGroupModules.module) : eq(classGroupModules.module, params.module),
          isNull(classGroupModules.deletedAt),
          movableClassGroup(),
        ),
      )
      .orderBy(asc(classGroups.startsOn), asc(classGroups.code));
  }

  async bringBack(params: Parameters<IEnrollmentFreezeRepository["bringBack"]>[0]): Promise<{ overCapacity: boolean }> {
    const { freeze, run } = params;
    return this.db.transaction(async (tx) => {
      const [current] = await tx
        .select({ id: enrollments.id })
        .from(enrollments)
        .where(and(eq(enrollments.id, freeze.enrollmentId), eq(enrollments.seatStatus, "frozen"), isNull(enrollments.deletedAt)))
        .for("update");
      if (!current) throw new EnrollmentFreezeConflictError();

      // The run must still be open as the seat is taken: the same predicate
      // the move uses, inside the atomic UPDATE.
      const seat = await takeManualSeatInOrder(tx, {
        candidates: [run.classGroupId],
        allowOverCapacity: params.allowOverCapacity,
        where: movableClassGroup(),
      });

      // The attempt it stopped in, unless the run already holds grades of this
      // enrollment from later tries: a monthly purchase is of the module and
      // attempt, and keeping the number keeps what was bought.
      await tx
        .update(enrollments)
        .set({
          classGroupId: run.classGroupId,
          classGroupModuleId: run.id,
          moduleAttempt: sql`greatest(${freeze.attempt}, 1 + (
            select count(*) from "grades" earlier
            where earlier.enrollment_id = ${freeze.enrollmentId}
              and coalesce(earlier.class_group_module_id, earlier.class_group_id) = ${run.id}
          ))`,
          moduleEnteredAt: sql`now()`,
          seatStatus: "confirmed",
          overCapacity: seat.overCapacity,
          updatedAt: sql`now()`,
        })
        .where(eq(enrollments.id, freeze.enrollmentId));

      // The unique index on freeze_id refuses a second return of the same freeze.
      await tx.insert(enrollmentFreezeReturns).values({
        freezeId: freeze.freezeId,
        classGroupId: run.classGroupId,
        classGroupModuleId: run.id,
        returnedBy: params.returnedBy,
      });

      await tx.insert(auditLog).values({
        actorId: params.audit.actorId,
        action: params.audit.action,
        targetId: freeze.enrollmentId,
        metadata: { ...params.audit.metadata, ...(seat.overCapacity ? { overCapacity: true } : {}) },
        createdAt: params.audit.at,
      });
      return { overCapacity: seat.overCapacity };
    });
  }
}

const runColumns = {
  id: classGroupModules.id,
  classGroupId: classGroups.id,
  courseId: classGroups.courseId,
  module: classGroupModules.module,
  open: sql<boolean>`${movableClassGroup()}`,
  code: classGroups.code,
  startsOn: classGroups.startsOn,
  slots: classGroupModules.slots,
  capacity: classGroups.capacity,
  seatsTaken: sql<number>`${classGroups.seatsTaken} + ${classGroups.seatsOver}`.mapWith(Number),
};
