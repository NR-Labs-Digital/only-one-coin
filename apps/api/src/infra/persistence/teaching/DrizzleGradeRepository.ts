import {
  sameGrade,
  type GradeEmailFacts,
  type GradeEntry,
  type GradeValue,
  type IGradeRepository,
  type RecordedGrade,
} from "@ooc/domain";
import { auditLog, classGroups, courses, enrollments, grades, guardians, students } from "@ooc/db";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
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

/**
 * The grades table (OOC-38, `0051`): append-only, one row per seat. A posted
 * grade is never updated — the database refuses it — so posting is an INSERT
 * that skips seats already graded, and a seat already graded with something
 * else rolls the whole batch back. The e-mails of the seats written go to
 * the outbox in the same transaction.
 */
export class DrizzleGradeRepository implements IGradeRepository {
  constructor(private readonly db: Db) {}

  async listForClassGroup(classGroupId: string): Promise<RecordedGrade[]> {
    const rows = await this.db
      .select({
        enrollmentId: grades.enrollmentId,
        score: grades.score,
        didNotSit: grades.didNotSit,
        createdAt: grades.createdAt,
      })
      .from(grades)
      .where(eq(grades.classGroupId, classGroupId))
      .orderBy(asc(grades.createdAt));

    return rows.map((row) => ({ enrollmentId: row.enrollmentId, value: valueOf(row), recordedAt: row.createdAt }));
  }

  async emailFacts(classGroupId: string, enrollmentIds: string[]): Promise<GradeEmailFacts[]> {
    if (enrollmentIds.length === 0) return [];
    const rows = await this.db
      .select({
        enrollmentId: enrollments.id,
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
              score: entry.value.kind === "score" ? entry.value.score : null,
              didNotSit: entry.value.kind === "did_not_sit",
              recordedBy: params.recordedBy,
            })),
          )
          .onConflictDoNothing({ target: [grades.classGroupId, grades.enrollmentId] })
          .returning({ enrollmentId: grades.enrollmentId });

        const written = new Set(inserted.map((row) => row.enrollmentId));
        const skipped = params.entries.filter((entry) => !written.has(entry.enrollmentId));

        if (skipped.length > 0) {
          const existing = await tx
            .select({ enrollmentId: grades.enrollmentId, score: grades.score, didNotSit: grades.didNotSit })
            .from(grades)
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
        if (recorded.length > 0) {
          // The grade and its e-mail commit together: a rolled-back batch
          // e-mails nobody, and a retry that writes nothing sends nothing.
          await insertOutboxEmails(tx, params.emails(recorded));
          const entry = params.audit(recorded);
          await tx.insert(auditLog).values({
            actorId: entry.actorId,
            action: entry.action,
            targetId: entry.targetId,
            metadata: entry.metadata ?? null,
            createdAt: entry.at,
          });
        }

        return { recorded: recorded.length, alreadyRecorded: skipped.length };
      });
    } catch (error) {
      if (error instanceof ConflictingGrades) return { conflicts: error.enrollmentIds };
      throw error;
    }
  }
}
