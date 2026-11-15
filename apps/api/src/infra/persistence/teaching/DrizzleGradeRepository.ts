import {
  sameGrade,
  type CorrectGradeOutcome,
  type GradeEmailFacts,
  type GradeEntry,
  type GradeValue,
  type GradeWithHistory,
  type IGradeRepository,
  type RecordedGrade,
} from "@ooc/domain";
import {
  auditLog,
  classGroups,
  courses,
  currentGrades,
  enrollments,
  gradeCorrections,
  grades,
  guardians,
  students,
} from "@ooc/db";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { AuditLogEntry } from "@ooc/domain";
import type { Db } from "@/infra/db/client.js";
import { insertOutboxEmails } from "@/infra/persistence/notification/DrizzleOutboxRepository.js";

class ConflictingGrades extends Error {
  constructor(readonly enrollmentIds: string[]) {
    super("conflicting grades");
  }
}

function valueOf(row: { score: number | null; didNotSit: boolean }): GradeValue {
  return row.didNotSit ? { kind: "did_not_sit" } : { kind: "score", score: Number(row.score) };
}

function columnsOf(value: GradeValue) {
  return {
    score: value.kind === "score" ? value.score : null,
    didNotSit: value.kind === "did_not_sit",
  };
}

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

async function insertAudit(tx: Tx, entry: AuditLogEntry): Promise<void> {
  await tx.insert(auditLog).values({
    actorId: entry.actorId,
    action: entry.action,
    targetId: entry.targetId,
    metadata: entry.metadata ?? null,
    createdAt: entry.at,
  });
}

/**
 * The grade of a seat's current attempt (OOC-156): posted in the run the
 * enrollment is in now, on the attempt it is on. A grade of a module it
 * already left, or of the time before it repeated, is history. Qualified by
 * hand — see `classGroupModuleSql.ts`.
 */
const CURRENT_ATTEMPT_OF_VIEW = sql`"current_grades"."enrollment_id" = "enrollments"."id"
  and "current_grades"."class_group_module_id" = coalesce("enrollments"."class_group_module_id", "enrollments"."class_group_id")
  and "current_grades"."attempt" = "enrollments"."module_attempt"`;

const CURRENT_ATTEMPT_OF_GRADE = sql`"grades"."enrollment_id" = "enrollments"."id"
  and coalesce("grades"."class_group_module_id", "grades"."class_group_id") = coalesce("enrollments"."class_group_module_id", "enrollments"."class_group_id")
  and "grades"."attempt" = "enrollments"."module_attempt"`;

/** Postgres' unique_violation — two corrections replacing the same one (0052's partial indexes). */
function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  while (current && typeof current === "object") {
    if ((current as { code?: unknown }).code === "23505") return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * The grades (OOC-38, `0051`) and their corrections (OOC-102, `0052`): both
 * append-only. A posted grade is never updated — the database refuses it —
 * so posting is an INSERT that skips seats already graded, and a seat already
 * graded with something else rolls the whole batch back. A correction is a
 * row of its own; which grade counts is `current_grades`, the one view every
 * read goes through. The e-mails go to the outbox in the same transaction.
 */
export class DrizzleGradeRepository implements IGradeRepository {
  constructor(private readonly db: Db) {}

  async listForClassGroup(classGroupId: string): Promise<RecordedGrade[]> {
    const rows = await this.db
      .select({
        enrollmentId: currentGrades.enrollmentId,
        score: currentGrades.score,
        didNotSit: currentGrades.didNotSit,
        recordedAt: currentGrades.recordedAt,
        correctedAt: currentGrades.correctedAt,
      })
      .from(currentGrades)
      .innerJoin(enrollments, CURRENT_ATTEMPT_OF_VIEW)
      .where(eq(currentGrades.classGroupId, classGroupId))
      .orderBy(asc(currentGrades.recordedAt));

    return rows.map((row) => ({
      enrollmentId: row.enrollmentId,
      value: valueOf(row),
      recordedAt: row.recordedAt,
      correctedAt: row.correctedAt,
    }));
  }

  async listWithHistory(classGroupId: string): Promise<GradeWithHistory[]> {
    const [current, posted, corrections] = await Promise.all([
      this.listForClassGroup(classGroupId),
      this.db
        .select({
          id: grades.id,
          enrollmentId: grades.enrollmentId,
          score: grades.score,
          didNotSit: grades.didNotSit,
          createdAt: grades.createdAt,
          byName: sql<string | null>`(select "name" from "user" where "id" = ${grades.recordedBy})`,
        })
        .from(grades)
        .innerJoin(enrollments, CURRENT_ATTEMPT_OF_GRADE)
        .where(eq(grades.classGroupId, classGroupId)),
      this.db
        .select({
          gradeId: gradeCorrections.gradeId,
          score: gradeCorrections.score,
          didNotSit: gradeCorrections.didNotSit,
          reason: gradeCorrections.reason,
          createdAt: gradeCorrections.createdAt,
          byName: sql<string | null>`(select "name" from "user" where "id" = ${gradeCorrections.correctedBy})`,
        })
        .from(gradeCorrections)
        .innerJoin(grades, eq(grades.id, gradeCorrections.gradeId))
        .innerJoin(enrollments, CURRENT_ATTEMPT_OF_GRADE)
        .where(eq(grades.classGroupId, classGroupId))
        // The line is straight (0052), so creation order is its order.
        .orderBy(asc(gradeCorrections.createdAt), asc(gradeCorrections.id)),
    ]);

    const postedBySeat = new Map(posted.map((row) => [row.enrollmentId, row]));
    const correctionsByGrade = new Map<string, typeof corrections>();
    for (const row of corrections) {
      const list = correctionsByGrade.get(row.gradeId) ?? [];
      list.push(row);
      correctionsByGrade.set(row.gradeId, list);
    }

    return current.map((grade) => {
      const original = postedBySeat.get(grade.enrollmentId);
      const history = original
        ? [
            { value: valueOf(original), at: original.createdAt, byName: original.byName, reason: null },
            ...(correctionsByGrade.get(original.id) ?? []).map((row) => ({
              value: valueOf(row),
              at: row.createdAt,
              byName: row.byName,
              reason: row.reason,
            })),
          ]
        : [];
      return { ...grade, history };
    });
  }

  async emailFacts(classGroupId: string, enrollmentIds: string[]): Promise<GradeEmailFacts[]> {
    if (enrollmentIds.length === 0) return [];
    const rows = await this.db
      .select({
        enrollmentId: enrollments.id,
        classGroupModuleId: sql<string>`coalesce("enrollments"."class_group_module_id", "enrollments"."class_group_id")`,
        attempt: enrollments.moduleAttempt,
        firstName: students.firstName,
        lastName: students.lastName,
        email: students.email,
        birthDate: students.birthDate,
        guardianFirstName: guardians.firstName,
        guardianEmail: guardians.email,
        courseName: courses.name,
      })
      .from(enrollments)
      .innerJoin(students, eq(students.id, enrollments.studentId))
      .innerJoin(classGroups, eq(classGroups.id, enrollments.classGroupId))
      .innerJoin(courses, eq(courses.id, classGroups.courseId))
      .leftJoin(guardians, and(eq(guardians.studentId, students.id), isNull(guardians.deletedAt)))
      .where(and(eq(enrollments.classGroupId, classGroupId), inArray(enrollments.id, enrollmentIds)));

    return rows.map((row) => ({
      enrollmentId: row.enrollmentId,
      classGroupModuleId: row.classGroupModuleId,
      attempt: row.attempt,
      student: { firstName: row.firstName, lastName: row.lastName, email: row.email, birthDate: row.birthDate },
      guardian:
        row.guardianFirstName !== null && row.guardianEmail !== null
          ? { firstName: row.guardianFirstName, email: row.guardianEmail }
          : null,
      courseName: row.courseName,
    }));
  }

  async record(params: Parameters<IGradeRepository["record"]>[0]) {
    try {
      return await this.db.transaction(async (tx) => {
        const inserted = await tx
          .insert(grades)
          .values(
            params.entries.map((entry) => ({
              enrollmentId: entry.enrollmentId,
              classGroupId: params.classGroupId,
              // The run and attempt the seat is on now (OOC-156): read from
              // the enrollment as the row is written, never handed in.
              classGroupModuleId: sql`(
                select coalesce(seat.class_group_module_id, seat.class_group_id)
                from "enrollments" seat where seat.id = ${entry.enrollmentId}
              )`,
              attempt: sql`(select seat.module_attempt from "enrollments" seat where seat.id = ${entry.enrollmentId})`,
              ...columnsOf(entry.value),
              recordedBy: params.recordedBy,
            })),
          )
          // The one unique index of 0059: seat, run and attempt.
          .onConflictDoNothing()
          .returning({ enrollmentId: grades.enrollmentId });

        const written = new Set(inserted.map((row) => row.enrollmentId));
        const skipped = params.entries.filter((entry) => !written.has(entry.enrollmentId));

        if (skipped.length > 0) {
          // Compared with the grade as posted, not as corrected: a sheet
          // resending what it posted before a correction is still a retry.
          const existing = await tx
            .select({ enrollmentId: grades.enrollmentId, score: grades.score, didNotSit: grades.didNotSit })
            .from(grades)
            .innerJoin(enrollments, CURRENT_ATTEMPT_OF_GRADE)
            .where(
              and(
                eq(grades.classGroupId, params.classGroupId),
                inArray(
                  grades.enrollmentId,
                  skipped.map((entry) => entry.enrollmentId),
                ),
              ),
            );
          const byId = new Map(existing.map((row) => [row.enrollmentId, valueOf(row)]));
          const conflicts = skipped
            .filter((entry) => {
              const posted = byId.get(entry.enrollmentId);
              return !posted || !sameGrade(posted, entry.value);
            })
            .map((entry) => entry.enrollmentId);
          if (conflicts.length > 0) throw new ConflictingGrades(conflicts);
        }

        const recorded: GradeEntry[] = params.entries.filter((entry) => written.has(entry.enrollmentId));
        let finished = false;
        if (recorded.length > 0) {
          // The grade and its e-mail commit together: a rolled-back batch
          // e-mails nobody, and a retry that writes nothing sends nothing.
          await insertOutboxEmails(tx, params.emails(recorded));
          await insertAudit(tx, params.audit(recorded));
          finished = await this.finishWhenComplete(tx, params.classGroupId, params.finishAudit);
        }

        return { recorded: recorded.length, alreadyRecorded: skipped.length, finished };
      });
    } catch (error) {
      if (error instanceof ConflictingGrades) return { conflicts: error.enrollmentIds };
      throw error;
    }
  }

  /**
   * OOC-102: the batch that leaves every confirmed seat graded finishes the
   * module — every seat of the class group, across all of its module runs
   * (OOC-156), counted here rather than handed in: a seat confirmed a moment
   * ago is one more to grade. Only from in progress — the WHERE on the status
   * makes a second, concurrent batch a no-op instead of a second step.
   */
  private async finishWhenComplete(tx: Tx, classGroupId: string, finishAudit: () => AuditLogEntry): Promise<boolean> {
    const [{ seats, ungraded }] = await tx
      .select({
        seats: sql<number>`count(*)::int`,
        // Aliased and qualified by hand: a single-table select prints its
        // columns bare, and a bare "id" in here would be the grade's.
        ungraded: sql<number>`count(*) filter (where not exists (
          select 1 from "grades" posted
          where posted.enrollment_id = "enrollments"."id"
            and coalesce(posted.class_group_module_id, posted.class_group_id) = coalesce("enrollments"."class_group_module_id", "enrollments"."class_group_id")
            and posted.attempt = "enrollments"."module_attempt"
        ))::int`,
      })
      .from(enrollments)
      .where(
        and(
          eq(enrollments.classGroupId, classGroupId),
          eq(enrollments.seatStatus, "confirmed"),
          isNull(enrollments.deletedAt),
        ),
      );
    if (seats === 0 || ungraded > 0) return false;

    const moved = await tx
      .update(classGroups)
      .set({ status: "finished", updatedAt: new Date() })
      .where(and(eq(classGroups.id, classGroupId), eq(classGroups.status, "in_progress")))
      .returning({ id: classGroups.id });
    if (moved.length === 0) return false;

    await insertAudit(tx, finishAudit());
    return true;
  }

  async correct(params: Parameters<IGradeRepository["correct"]>[0]): Promise<CorrectGradeOutcome> {
    try {
      return await this.db.transaction(async (tx) => {
        const [posted] = await tx
          .select({ id: grades.id })
          .from(grades)
          .innerJoin(enrollments, CURRENT_ATTEMPT_OF_GRADE)
          .where(and(eq(grades.classGroupId, params.classGroupId), eq(grades.enrollmentId, params.enrollmentId)));
        if (!posted) return { kind: "not_graded" } as const;

        const [current] = await tx
          .select({
            score: currentGrades.score,
            didNotSit: currentGrades.didNotSit,
            correctionId: currentGrades.correctionId,
          })
          .from(currentGrades)
          .where(eq(currentGrades.gradeId, posted.id));
        if (current && sameGrade(valueOf(current), params.value)) return { kind: "same_value" } as const;

        const [correction] = await tx
          .insert(gradeCorrections)
          .values({
            gradeId: posted.id,
            replacesId: current?.correctionId ?? null,
            ...columnsOf(params.value),
            reason: params.reason,
            correctedBy: params.correctedBy,
          })
          .returning({ id: gradeCorrections.id });

        await insertOutboxEmails(tx, params.emails(correction.id));
        await insertAudit(tx, params.audit(correction.id));
        return { kind: "corrected", correctionId: correction.id } as const;
      });
    } catch (error) {
      // Somebody else's correction replaced the same link first.
      if (isUniqueViolation(error)) return { kind: "concurrent" };
      throw error;
    }
  }
}
