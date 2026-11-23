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
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
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
        const locked = await lockLive(tx, params.id);
        if (!locked) return { outcome: "not_found" } as const;

        const { rows } = await tx.execute<{ blocker: ClassGroupDeleteBlocker | null }>(
          sql`select ${classGroupDeleteBlockerSql(sql`${params.id}::uuid`)} as blocker`,
        );
        const reason = rows[0]?.blocker ?? null;
        if (reason) return erase(tx, locked, reason, params);

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
          metadata: snapshotOf(locked),
          createdAt: params.at,
        });
        return { outcome: "deleted" } as const;
      });
    } catch (error) {
      if (!isForeignKeyViolation(error)) throw error;
      // A reference the blocker list does not know about: Postgres refused
      // and rolled the delete back. The class group has history after all,
      // so it is erased instead, in a transaction of its own.
      return this.db.transaction(async (tx) => {
        const locked = await lockLive(tx, params.id);
        if (!locked) return { outcome: "not_found" } as const;
        return erase(tx, locked, "history", params);
      });
    }
  }
}

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Locked = NonNullable<Awaited<ReturnType<typeof lockLive>>>;

/** The class group, locked, unless it does not exist or was already erased. */
async function lockLive(tx: Tx, id: string) {
  const [row] = await tx
    .select({
      id: classGroups.id,
      code: classGroups.code,
      courseId: classGroups.courseId,
      academicPeriodId: classGroups.academicPeriodId,
      status: classGroups.status,
      retired: sql<boolean>`${classGroups.deletedAt} is not null`,
    })
    .from(classGroups)
    .where(and(eq(classGroups.id, id), isNull(classGroups.erasedAt)))
    .for("update");
  return row ?? null;
}

function snapshotOf(locked: Locked) {
  return {
    code: locked.code,
    courseId: locked.courseId,
    academicPeriodId: locked.academicPeriodId,
    status: locked.status,
    retired: locked.retired,
  };
}

/**
 * A class group with history cannot be deleted — its enrollments and
 * payments point at it, and those never go (CLAUDE.md §6). It is erased
 * instead: retired if it was not, and marked so no catalog screen shows it
 * and nothing restores it. Enrollments and payments stay where they are.
 */
async function erase(
  tx: Tx,
  locked: Locked,
  reason: ClassGroupDeleteBlocker,
  params: { id: string; actorId: string; at: Date },
): Promise<ClassGroupDeleteOutcome> {
  await tx
    .update(classGroups)
    .set({ erasedAt: params.at, deletedAt: sql`coalesce(${classGroups.deletedAt}, ${params.at})`, updatedAt: params.at })
    .where(eq(classGroups.id, params.id));
  await tx.insert(auditLog).values({
    actorId: params.actorId,
    action: "catalog.class_group.erased",
    targetId: params.id,
    metadata: { ...snapshotOf(locked), reason },
    createdAt: params.at,
  });
  return { outcome: "erased", reason };
}

function isForeignKeyViolation(error: unknown): boolean {
  for (let current: unknown = error; current; current = (current as { cause?: unknown }).cause) {
    if ((current as { code?: unknown }).code === FOREIGN_KEY_VIOLATION) return true;
  }
  return false;
}
