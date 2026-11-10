import { sameGrade, type GradeEntry, type GradeValue, type IGradeRepository, type RecordedGrade } from "@ooc/domain";
import { auditLog, grades } from "@ooc/db";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { Db } from "@/infra/db/client.js";

class ConflictingGrades extends Error {
  constructor(readonly enrollmentIds: string[]) {
    super("conflicting grades");
  }
}

function valueOf(row: { score: number | null; didNotSit: boolean }): GradeValue {
  return row.didNotSit ? { kind: "did_not_sit" } : { kind: "score", score: Number(row.score) };
}

/**
 * The grades table (OOC-38, `0050`): append-only, one row per seat. A posted
 * grade is never updated — the database refuses it — so posting is an INSERT
 * that skips seats already graded, and a seat already graded with something
 * else rolls the whole batch back.
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
