import { auditLog, classGroupModules, classGroups, courses, currentGrades, enrollments, students } from "@ooc/db";
import type { GradeValue, IProgressionRepository, ProgressionRun, ProgressionSeat } from "@ooc/domain";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "@/infra/db/client.js";
import { queueMonthlyDueReminders } from "@/infra/persistence/payment/monthlyReminders.js";
import { enrollmentInModule } from "../catalog/classGroupModuleSql.js";

class ProgressionConflict extends Error {
  constructor(readonly enrollmentIds: string[]) {
    super("progression conflict");
  }
}

/**
 * Moving seats between the module runs of a class group (OOC-156). The seat
 * of the class group never moves — only which run the enrollment is in, and
 * which attempt. Every write is conditional on what the preview read, so a
 * second person confirming the same run moves nobody twice.
 */
export class DrizzleProgressionRepository implements IProgressionRepository {
  constructor(private readonly db: Db) {}

  async seatsOf(classGroupModuleId: string): Promise<ProgressionSeat[]> {
    const rows = await this.db
      .select({
        enrollmentId: enrollments.id,
        firstName: students.firstName,
        lastName: students.lastName,
        attempt: enrollments.moduleAttempt,
        score: currentGrades.score,
        didNotSit: currentGrades.didNotSit,
        gradeId: currentGrades.gradeId,
      })
      .from(enrollments)
      .innerJoin(students, eq(students.id, enrollments.studentId))
      // The grade of the attempt the seat is on now; qualified by hand
      // (`classGroupModuleSql.ts`).
      .leftJoin(
        currentGrades,
        sql`"current_grades"."enrollment_id" = "enrollments"."id"
          and "current_grades"."class_group_module_id" = coalesce("enrollments"."class_group_module_id", "enrollments"."class_group_id")
          and "current_grades"."attempt" = "enrollments"."module_attempt"`,
      )
      .where(
        and(
          enrollmentInModule(classGroupModuleId),
          eq(enrollments.seatStatus, "confirmed"),
          isNull(enrollments.deletedAt),
        ),
      )
      .orderBy(asc(students.lastName), asc(students.firstName), asc(enrollments.id));

    return rows.map((row) => ({
      enrollmentId: row.enrollmentId,
      firstName: row.firstName,
      lastName: row.lastName,
      attempt: row.attempt,
      grade:
        row.gradeId === null
          ? null
          : row.didNotSit
            ? ({ kind: "did_not_sit" } satisfies GradeValue)
            : ({ kind: "score", score: Number(row.score) } satisfies GradeValue),
    }));
  }

  async runOfModule(classGroupId: string, module: number): Promise<ProgressionRun | null> {
    const [row] = await this.db
      .select({ id: classGroupModules.id, module: classGroupModules.module })
      .from(classGroupModules)
      .where(
        and(
          eq(classGroupModules.classGroupId, classGroupId),
          eq(classGroupModules.module, module),
          isNull(classGroupModules.deletedAt),
        ),
      )
      .limit(1);
    return row ? { id: row.id, module: row.module! } : null;
  }

  async courseModules(classGroupId: string): Promise<number> {
    const [row] = await this.db
      .select({ modules: courses.modules })
      .from(classGroups)
      .innerJoin(courses, eq(courses.id, classGroups.courseId))
      .where(eq(classGroups.id, classGroupId))
      .limit(1);
    return row?.modules ?? 0;
  }

  async apply(params: Parameters<IProgressionRepository["apply"]>[0]) {
    try {
      return await this.db.transaction(async (tx) => {
        const conflicts: string[] = [];
        const stillHere = (enrollmentId: string, attempt: number) =>
          and(
            eq(enrollments.id, enrollmentId),
            enrollmentInModule(params.fromRunId),
            eq(enrollments.moduleAttempt, attempt),
            eq(enrollments.seatStatus, "confirmed"),
            isNull(enrollments.deletedAt),
          );

        for (const seat of params.advance) {
          // A run the student already took before (moved back, then on
          // again) keeps its grades: the new attempt comes after them.
          const moved = await tx
            .update(enrollments)
            .set({
              classGroupModuleId: params.toRunId,
              moduleAttempt: sql`1 + (
                select count(*) from "grades" earlier
                where earlier.enrollment_id = ${seat.enrollmentId}
                  and coalesce(earlier.class_group_module_id, earlier.class_group_id) = ${params.toRunId}
              )`,
              moduleEnteredAt: sql`now()`,
              updatedAt: sql`now()`,
            })
            .where(stillHere(seat.enrollmentId, seat.attempt))
            .returning({ id: enrollments.id });
          if (moved.length === 0) conflicts.push(seat.enrollmentId);
        }

        for (const seat of params.repeat) {
          const repeated = await tx
            .update(enrollments)
            .set({ moduleAttempt: seat.attempt + 1, moduleEnteredAt: sql`now()`, updatedAt: sql`now()` })
            .where(stillHere(seat.enrollmentId, seat.attempt))
            .returning({ id: enrollments.id });
          if (repeated.length === 0) conflicts.push(seat.enrollmentId);
        }

        if (conflicts.length > 0) throw new ProgressionConflict(conflicts);

        // A monthly seat now in a module nobody bought hears about it, in this
        // same transaction (OOC-86).
        await queueMonthlyDueReminders(tx, [...params.advance, ...params.repeat].map((seat) => seat.enrollmentId));

        await tx.insert(auditLog).values({
          actorId: params.audit.actorId,
          action: params.audit.action,
          targetId: params.audit.targetId,
          metadata: params.audit.metadata,
          createdAt: params.audit.at,
        });
        return { advanced: params.advance.length, repeated: params.repeat.length };
      });
    } catch (error) {
      if (error instanceof ProgressionConflict) return { conflicts: error.enrollmentIds };
      throw error;
    }
  }
}
