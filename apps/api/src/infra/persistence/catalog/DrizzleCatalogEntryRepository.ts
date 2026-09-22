import type {
  CatalogEntryKind,
  CatalogEntryState,
  ICatalogEntryRepository,
} from "@ooc/domain";
import { academicPeriods, classGroups, courses, enrollments, planPrices, plans } from "@ooc/db";
import { and, eq, isNull, ne, sql } from "drizzle-orm";
import type { Db } from "@/infra/db/client.js";

/**
 * The four catalog tables behind one port. The kind→table switch lives here
 * and not in the domain for the usual reason: which table a concept sleeps in
 * is infrastructure's business.
 *
 * "Live enrollment" is defined once, below, and it is a count for a warning,
 * not a gate — retiring is never refused over it (see RetireCatalogEntryUseCase).
 */
export class DrizzleCatalogEntryRepository implements ICatalogEntryRepository {
  constructor(private readonly db: Db) {}

  async find(kind: CatalogEntryKind, id: string): Promise<CatalogEntryState | null> {
    const [row] = await this.selectEntry(kind, id);

    if (!row) {
      return null;
    }

    return {
      kind,
      id: row.id,
      retiredAt: row.deletedAt,
      liveEnrollments: await this.countLiveEnrollments(kind, id),
    };
  }

  async retire(kind: CatalogEntryKind, id: string, at: Date): Promise<void> {
    const table = tableFor(kind);

    await this.db
      .update(table)
      .set({ deletedAt: at, updatedAt: at })
      // `isNull` keeps the first retirement date even if two calls race: the
      // second one matches no row instead of overwriting when it happened.
      .where(and(eq(table.id, id), isNull(table.deletedAt)));
  }

  async restore(kind: CatalogEntryKind, id: string): Promise<void> {
    const table = tableFor(kind);

    await this.db
      .update(table)
      .set({ deletedAt: null, updatedAt: new Date() })
      .where(eq(table.id, id));
  }

  private selectEntry(kind: CatalogEntryKind, id: string) {
    const table = tableFor(kind);

    return this.db
      .select({ id: table.id, deletedAt: table.deletedAt })
      .from(table)
      .where(eq(table.id, id))
      .limit(1);
  }

  /**
   * Enrollments still standing on the entry: not retired themselves, and still
   * holding a seat — a `released` seat has already been handed back, so it is
   * not something retiring the entry would disturb.
   */
  private async countLiveEnrollments(kind: CatalogEntryKind, id: string): Promise<number> {
    const standing = and(isNull(enrollments.deletedAt), ne(enrollments.seatStatus, "released"));
    const count = sql<number>`count(*)`.mapWith(Number);

    if (kind === "class_group") {
      const [row] = await this.db
        .select({ count })
        .from(enrollments)
        .where(and(standing, eq(enrollments.classGroupId, id)));

      return row?.count ?? 0;
    }

    if (kind === "plan") {
      // An enrollment names the price it froze, not the plan (CLAUDE.md §5),
      // so the plan is one hop away through plan_prices.
      const [row] = await this.db
        .select({ count })
        .from(enrollments)
        .innerJoin(planPrices, eq(planPrices.id, enrollments.planPriceId))
        .where(and(standing, eq(planPrices.planId, id)));

      return row?.count ?? 0;
    }

    const column = kind === "course" ? classGroups.courseId : classGroups.academicPeriodId;

    const [row] = await this.db
      .select({ count })
      .from(enrollments)
      .innerJoin(classGroups, eq(classGroups.id, enrollments.classGroupId))
      .where(and(standing, eq(column, id)));

    return row?.count ?? 0;
  }
}

function tableFor(kind: CatalogEntryKind) {
  switch (kind) {
    case "academic_period":
      return academicPeriods;
    case "course":
      return courses;
    case "plan":
      return plans;
    case "class_group":
      return classGroups;
  }
}
