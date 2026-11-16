import { academicPeriods, classGroupModules, classGroups, courses, enrollments, planPrices, plans } from "@ooc/db";
import { and, asc, desc, eq, inArray, isNull, lte, ne, sql } from "drizzle-orm";
import type { Db } from "@/infra/db/client.js";
import { movableClassGroup } from "@/infra/persistence/catalog/sellableClassGroup.js";
import { enrollmentModuleId, MODULE_ORDER } from "@/infra/persistence/catalog/classGroupModuleSql.js";
import { moduleTeacherName } from "@/infra/persistence/catalog/classGroupTeacherName.js";

/**
 * One module run a seat can move to (OOC-156). `id` is the run's — what the
 * move names; `classGroupId`, code, capacity and seats are its class group's.
 */
export interface MoveTargetClassGroup {
  id: string;
  classGroupId: string;
  code: string;
  teacherName: string;
  courseId: string;
  academicPeriodId: string;
  courseName: string;
  academicPeriodName: string;
  schedule: string;
  slots: unknown;
  startsOn: string | null;
  endsOn: string | null;
  status: string;
  module: number | null;
  fullCourse: boolean;
  capacity: number;
  seatsTaken: number;
  seatsOver: number;
}

export interface MoveTargetPlan {
  id: string;
  courseId: string;
  name: string;
  amountCents: number;
}

export interface MoveTargets {
  courseId: string;
  classGroupId: string;
  /** The run the seat is in now. */
  classGroupModuleId: string;
  classGroups: MoveTargetClassGroup[];
  plans: MoveTargetPlan[];
}

/** Enough for a picker; a coordinator moving a seat is looking at running class groups. */
const MOVE_TARGET_LIMIT = 500;

/**
 * What the move dialog offers (OOC-84): every live module run (OOC-156) of
 * every class group staff could move the enrollment to (`movableClassGroup`,
 * the same predicate the move's own UPDATE checks) except the run it is in —
 * the other runs of its own class group included — full ones included: a full target
 * asks for the over-capacity confirmation (OOC-155) — and the live plans of
 * those courses with their price in force, for a move that changes course.
 * Read-only shaping; the move itself decides nothing from it.
 *
 * Null when there is no live enrollment with that id.
 */
export class ListMoveTargetsQuery {
  constructor(private readonly db: Db) {}

  async run(enrollmentId: string): Promise<MoveTargets | null> {
    const [source] = await this.db
      .select({
        classGroupId: enrollments.classGroupId,
        classGroupModuleId: enrollmentModuleId(),
        courseId: classGroups.courseId,
      })
      .from(enrollments)
      .innerJoin(classGroups, eq(classGroups.id, enrollments.classGroupId))
      .where(and(eq(enrollments.id, enrollmentId), isNull(enrollments.deletedAt)))
      .limit(1);
    if (!source) return null;

    const groupRows = await this.db
      .select({
        id: classGroupModules.id,
        classGroupId: classGroups.id,
        code: classGroups.code,
        teacherName: moduleTeacherName(sql`${classGroupModules.id}`),
        courseId: classGroups.courseId,
        academicPeriodId: classGroups.academicPeriodId,
        courseName: courses.name,
        academicPeriodName: academicPeriods.name,
        schedule: classGroups.schedule,
        slots: classGroupModules.slots,
        startsOn: classGroups.startsOn,
        endsOn: classGroups.endsOn,
        status: classGroups.status,
        module: classGroupModules.module,
        fullCourse: classGroupModules.fullCourse,
        capacity: classGroups.capacity,
        seatsTaken: classGroups.seatsTaken,
        seatsOver: classGroups.seatsOver,
      })
      .from(classGroupModules)
      .innerJoin(classGroups, eq(classGroups.id, classGroupModules.classGroupId))
      .innerJoin(courses, eq(courses.id, classGroups.courseId))
      .innerJoin(academicPeriods, eq(academicPeriods.id, classGroups.academicPeriodId))
      .where(
        and(movableClassGroup(), isNull(classGroupModules.deletedAt), ne(classGroupModules.id, source.classGroupModuleId)),
      )
      .orderBy(asc(courses.name), asc(classGroups.startsOn), asc(classGroups.code), ...MODULE_ORDER)
      .limit(MOVE_TARGET_LIMIT);

    const courseIds = [...new Set(groupRows.map((row) => row.courseId))];
    const priceRows =
      courseIds.length === 0
        ? []
        : await this.db
            .select({
              id: plans.id,
              courseId: plans.courseId,
              name: plans.name,
              amountCents: planPrices.amountCents,
            })
            .from(plans)
            .innerJoin(planPrices, eq(planPrices.planId, plans.id))
            .where(and(inArray(plans.courseId, courseIds), isNull(plans.deletedAt), lte(planPrices.validFrom, sql`now()`)))
            .orderBy(asc(plans.name), desc(planPrices.validFrom));

    // Newest price first per plan: the first row seen is the price in force.
    const seen = new Set<string>();
    const planList: MoveTargetPlan[] = [];
    for (const row of priceRows) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      planList.push(row);
    }

    return {
      courseId: source.courseId,
      classGroupId: source.classGroupId,
      classGroupModuleId: source.classGroupModuleId,
      classGroups: groupRows.map((row) => ({
        ...row,
        startsOn: row.startsOn?.toISOString() ?? null,
        endsOn: row.endsOn?.toISOString() ?? null,
      })),
      plans: planList,
    };
  }
}
