import type { ClassGroupDeleteBlocker, ClassGroupDeleteOutcome, IClassGroupDeletionRepository } from "@ooc/domain";
import {
  auditLog,
  classGroupModules,
  classGroups,
  reportClassGroupFacts,
  reportMonthFacts,
  reportRunFacts,
  seatHolds,
} from "@ooc/db";
import { eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@/infra/db/client.js";
import { classGroupDeleteBlockerSql } from "./classGroupDeleteBlocker.js";

/** Postgres `foreign_key_violation`. */
const FOREIGN_KEY_VIOLATION = "23503";

/**
 * The one physical delete of the catalog (CLAUDE.md §1, exception of
 * 23/11/2026). `class_groups` and `class_group_modules` were never in the
 * tables migration 0011 locked against DELETE; what keeps a class group with
 * history in place is every foreign key pointing at it being
 * `ON DELETE RESTRICT`, and the blocker check before that.
 *
 * The class group row is locked first. Every write that could give it a
 * history — the checkout's claim and the manual enrollment update its seat
 * counter; a waitlist entry or a copy checks its foreign key, which takes a
 * share lock on the row — waits for this transaction, then finds the class
 * group gone.
 */
export class DrizzleClassGroupDeletionRepository implements IClassGroupDeletionRepository {
  constructor(private readonly db: Db) {}

  async delete(params: { id: string; actorId: string; at: Date }): Promise<ClassGroupDeleteOutcome> {
    try {
      return await this.db.transaction(async (tx) => {
        const [locked] = await tx
          .select({
            id: classGroups.id,
            code: classGroups.code,
            courseId: classGroups.courseId,
            academicPeriodId: classGroups.academicPeriodId,
            status: classGroups.status,
            retired: sql<boolean>`${classGroups.deletedAt} is not null`,
          })
          .from(classGroups)
          .where(eq(classGroups.id, params.id))
          .for("update");
        if (!locked) return { outcome: "not_found" } as const;

        const { rows } = await tx.execute<{ blocker: ClassGroupDeleteBlocker | null }>(
          sql`select ${classGroupDeleteBlockerSql(sql`${params.id}::uuid`)} as blocker`,
        );
        const check = rows[0];
        if (check?.blocker) return { outcome: "blocked", blocker: check.blocker } as const;

        const runIds = tx
          .select({ id: classGroupModules.id })
          .from(classGroupModules)
          .where(eq(classGroupModules.classGroupId, params.id));

        // Derived figures first (the nightly refresh rebuilds them), then the
        // holds nobody took, then the runs, then the class group.
        await tx.delete(reportMonthFacts).where(inArray(reportMonthFacts.classGroupModuleId, runIds));
        await tx.delete(reportRunFacts).where(inArray(reportRunFacts.classGroupModuleId, runIds));
        await tx.delete(reportClassGroupFacts).where(eq(reportClassGroupFacts.classGroupId, params.id));
        await tx.delete(seatHolds).where(eq(seatHolds.classGroupId, params.id));
        await tx.delete(classGroupModules).where(eq(classGroupModules.classGroupId, params.id));
        await tx.delete(classGroups).where(eq(classGroups.id, params.id));

        // What it was, so the trail still says something once the row is
        // gone: the code people knew it by, and where it sat.
        await tx.insert(auditLog).values({
          actorId: params.actorId,
          action: "catalog.class_group.deleted",
          targetId: params.id,
          metadata: {
            code: locked.code,
            courseId: locked.courseId,
            academicPeriodId: locked.academicPeriodId,
            status: locked.status,
            retired: locked.retired,
          },
          createdAt: params.at,
        });
        return { outcome: "deleted" } as const;
      });
    } catch (error) {
      // A reference the blocker list does not know about: Postgres refused,
      // the transaction rolled back, and the class group is still there.
      if (isForeignKeyViolation(error)) return { outcome: "blocked", blocker: "history" };
      throw error;
    }
  }
}

function isForeignKeyViolation(error: unknown): boolean {
  for (let current: unknown = error; current; current = (current as { cause?: unknown }).cause) {
    if ((current as { code?: unknown }).code === FOREIGN_KEY_VIOLATION) return true;
  }
  return false;
}
