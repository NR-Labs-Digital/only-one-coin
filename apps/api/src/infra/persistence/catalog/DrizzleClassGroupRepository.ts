import {
  CapacityBelowSeatsTakenError,
  ClassGroup,
  classGroupCodeOf,
  ClassGroupModule,
  ClassGroupModuleHasStudentsError,
  ClassGroupModuleTakenError,
  PeriodAlreadyDuplicatedError,
  type ClassGroupStatus,
  type IClassGroupRepository,
  type WeeklySlot,
} from "@ooc/domain";
import { academicPeriods, classGroupModules, classGroups, courses, enrollments } from "@ooc/db";
import { aliasedTable, and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "@/infra/db/client.js";
import { scheduleTextFromSlots } from "./scheduleText.js";
import { enrollmentInModule } from "./classGroupModuleSql.js";

type Row = typeof classGroups.$inferSelect;
type ModuleRow = typeof classGroupModules.$inferSelect;

export function classGroupModuleFromRow(row: ModuleRow): ClassGroupModule {
  return new ClassGroupModule({
    id: row.id,
    classGroupId: row.classGroupId,
    module: row.module,
    fullCourse: row.fullCourse,
    teacherId: row.teacherId,
    legacyTeacherName: row.teacherName,
    slots: row.slots as WeeklySlot[],
    classroomLinks: row.classroomLinks,
    classroomUrl: row.classroomUrl,
    meetUrl: row.meetUrl,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  });
}

export function classGroupFromRow(row: Row, modules: ModuleRow[] = []): ClassGroup {
  return new ClassGroup(
    {
      id: row.id,
      courseId: row.courseId,
      academicPeriodId: row.academicPeriodId,
      code: row.code,
      startsOn: row.startsOn,
      endsOn: row.endsOn,
      enrollmentOpensAt: row.enrollmentOpensAt,
      enrollmentClosesAt: row.enrollmentClosesAt,
      capacity: row.capacity,
      seatsTaken: row.seatsTaken,
      seatsOver: row.seatsOver,
      status: row.status as ClassGroupStatus,
      sourceClassGroupId: row.sourceClassGroupId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      deletedAt: row.deletedAt,
    },
    modules.map(classGroupModuleFromRow),
  );
}

/**
 * The class group's own columns. Its teaching columns (teacher, slots, module,
 * Classroom) are frozen since 0058 and written by nobody — the module runs
 * carry them. `schedule` is the text twin of the entry run's slots, kept for
 * the ledger search and the legacy import; a legacy class group with no slots
 * keeps the text it came with.
 */
function insertValues(group: ClassGroup, legacySchedule = "") {
  const entrySlots = group.entryModule?.slots ?? [];
  return {
    id: group.id,
    courseId: group.courseId,
    academicPeriodId: group.academicPeriodId,
    schedule: entrySlots.length > 0 ? scheduleTextFromSlots(entrySlots) : legacySchedule,
    code: group.code,
    startsOn: group.startsOn,
    endsOn: group.endsOn,
    enrollmentOpensAt: group.enrollmentOpensAt,
    enrollmentClosesAt: group.enrollmentClosesAt,
    capacity: group.capacity,
    seatsTaken: 0,
    status: group.status,
    sourceClassGroupId: group.sourceClassGroupId,
  };
}

function moduleValues(run: ClassGroupModule) {
  return {
    id: run.id,
    classGroupId: run.classGroupId,
    module: run.module,
    fullCourse: run.fullCourse,
    teacherId: run.teacherId,
    teacherName: run.legacyTeacherName,
    slots: run.slots,
    classroomLinks: run.classroomLinks,
    classroomUrl: run.classroomUrl,
    meetUrl: run.meetUrl,
  };
}

/** Postgres' unique_violation, wherever the driver nests it. */
function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  while (current && typeof current === "object") {
    if ((current as { code?: unknown }).code === "23505") return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** The class group's `schedule` text follows its entry run's slots. */
async function refreshScheduleText(tx: Db | Tx, classGroupId: string): Promise<void> {
  const [entry] = await tx
    .select({ slots: classGroupModules.slots })
    .from(classGroupModules)
    .where(and(eq(classGroupModules.classGroupId, classGroupId), isNull(classGroupModules.deletedAt)))
    .orderBy(sql`${classGroupModules.module} asc nulls first`, asc(classGroupModules.createdAt), asc(classGroupModules.id))
    .limit(1);
  const slots = (entry?.slots ?? []) as WeeklySlot[];
  if (slots.length === 0) return;
  await tx.update(classGroups).set({ schedule: scheduleTextFromSlots(slots) }).where(eq(classGroups.id, classGroupId));
}

export class DrizzleClassGroupRepository implements IClassGroupRepository {
  constructor(private readonly db: Db) {}

  async nextCodes(count: number): Promise<string[]> {
    if (count === 0) return [];
    const rows = await this.db.execute<{ seq: string }>(
      sql`select nextval('class_group_code_seq')::text as seq from generate_series(1, ${count})`,
    );
    return rows.rows.map((row) => Number(row.seq)).sort((a, b) => a - b).map(classGroupCodeOf);
  }

  async create(group: ClassGroup): Promise<ClassGroup> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx.insert(classGroups).values(insertValues(group)).returning();
      if (!row) throw new Error("Insert into class_groups returned no row");
      const modules = group.modules.length
        ? await tx.insert(classGroupModules).values(group.modules.map(moduleValues)).returning()
        : [];
      return classGroupFromRow(row, modules);
    });
  }

  async findById(id: string): Promise<ClassGroup | null> {
    const [row] = await this.db.select().from(classGroups).where(eq(classGroups.id, id)).limit(1);
    if (!row) return null;
    const modules = await this.db
      .select()
      .from(classGroupModules)
      .where(and(eq(classGroupModules.classGroupId, id), isNull(classGroupModules.deletedAt)));
    return classGroupFromRow(row, modules);
  }

  /**
   * The class group's own fields. Never writes seats_taken, and never lowers
   * capacity below it: the WHERE re-reads the counter at write time, so a seat
   * the checkout took a moment ago counts (apps/api CLAUDE.md, "nunca validar
   * vaga na aplicação"). Its module runs are saved by their own methods.
   */
  async update(group: ClassGroup): Promise<ClassGroup> {
    const [row] = await this.db
      .update(classGroups)
      .set({
        courseId: group.courseId,
        startsOn: group.startsOn,
        endsOn: group.endsOn,
        enrollmentOpensAt: group.enrollmentOpensAt,
        enrollmentClosesAt: group.enrollmentClosesAt,
        capacity: group.capacity,
        status: group.status,
        updatedAt: group.updatedAt,
      })
      .where(and(eq(classGroups.id, group.id), sql`${classGroups.seatsTaken} <= ${group.capacity}`))
      .returning();
    if (!row) throw new CapacityBelowSeatsTakenError();
    return classGroupFromRow(
      row,
      group.modules.map((run) => ({ ...moduleValues(run), createdAt: run.createdAt, updatedAt: run.updatedAt, deletedAt: null })),
    );
  }

  async insertModule(run: ClassGroupModule): Promise<ClassGroupModule> {
    try {
      return await this.db.transaction(async (tx) => {
        const [row] = await tx.insert(classGroupModules).values(moduleValues(run)).returning();
        if (!row) throw new Error("Insert into class_group_modules returned no row");
        await refreshScheduleText(tx, run.classGroupId);
        return classGroupModuleFromRow(row);
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new ClassGroupModuleTakenError({ cause: error });
      throw error;
    }
  }

  async updateModule(run: ClassGroupModule): Promise<ClassGroupModule> {
    try {
      return await this.db.transaction(async (tx) => {
        const [row] = await tx
          .update(classGroupModules)
          .set({
            module: run.module,
            fullCourse: run.fullCourse,
            teacherId: run.teacherId,
            teacherName: run.legacyTeacherName,
            slots: run.slots,
            classroomLinks: run.classroomLinks,
            updatedAt: run.updatedAt,
          })
          .where(and(eq(classGroupModules.id, run.id), isNull(classGroupModules.deletedAt)))
          .returning();
        if (!row) throw new Error("The module run left the catalog while it was being edited");
        await refreshScheduleText(tx, run.classGroupId);
        return classGroupModuleFromRow(row);
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new ClassGroupModuleTakenError({ cause: error });
      throw error;
    }
  }

  /**
   * Conditional on the write itself: a live seat — reserved or confirmed — in
   * the run keeps it. A seat taken a moment ago counts, the same as capacity.
   */
  async retireModule(run: ClassGroupModule): Promise<void> {
    await this.db.transaction(async (tx) => {
      const retired = await tx
        .update(classGroupModules)
        .set({ deletedAt: run.deletedAt ?? new Date(), updatedAt: run.updatedAt })
        .where(
          and(
            eq(classGroupModules.id, run.id),
            isNull(classGroupModules.deletedAt),
            sql`not exists (
              select 1 from ${enrollments}
              where ${enrollments.classGroupId} = ${run.classGroupId}
                and ${enrollmentInModule(run.id)}
                and ${enrollments.seatStatus} <> 'released'
                and ${enrollments.deletedAt} is null
            )`,
          ),
        )
        .returning({ id: classGroupModules.id });
      if (retired.length === 0) throw new ClassGroupModuleHasStudentsError();
      await refreshScheduleText(tx, run.classGroupId);
    });
  }

  async listForCopy(periodId: string): Promise<{ copyable: ClassGroup[]; skippedRetired: number }> {
    const rows = await this.db
      .select({ group: classGroups, courseDeletedAt: courses.deletedAt })
      .from(classGroups)
      .innerJoin(courses, eq(courses.id, classGroups.courseId))
      .where(eq(classGroups.academicPeriodId, periodId));

    const live = rows.filter((row) => row.group.deletedAt === null && row.courseDeletedAt === null);
    const ids = live.map((row) => row.group.id);
    const modules =
      ids.length === 0
        ? []
        : await this.db
            .select()
            .from(classGroupModules)
            .where(and(inArray(classGroupModules.classGroupId, ids), isNull(classGroupModules.deletedAt)));
    const byGroup = new Map<string, ModuleRow[]>();
    for (const run of modules) byGroup.set(run.classGroupId, [...(byGroup.get(run.classGroupId) ?? []), run]);

    return {
      copyable: live.map((row) => classGroupFromRow(row.group, byGroup.get(row.group.id) ?? [])),
      skippedRetired: rows.length - live.length,
    };
  }

  async insertCopies(sourcePeriodId: string, targetPeriodId: string, copies: ClassGroup[]): Promise<void> {
    await this.db.transaction(async (tx) => {
      // Serializes two duplications into the same target: the second one
      // waits here, then sees the first one's copies below.
      await tx
        .select({ id: academicPeriods.id })
        .from(academicPeriods)
        .where(eq(academicPeriods.id, targetPeriodId))
        .for("update");

      const source = aliasedTable(classGroups, "source");
      const [already] = await tx
        .select({ id: classGroups.id })
        .from(classGroups)
        .innerJoin(source, eq(source.id, classGroups.sourceClassGroupId))
        .where(and(eq(classGroups.academicPeriodId, targetPeriodId), eq(source.academicPeriodId, sourcePeriodId)))
        .limit(1);
      if (already) throw new PeriodAlreadyDuplicatedError();

      if (copies.length === 0) return;

      // A legacy source has its schedule only as text — carry it over rather
      // than leave the copy with no schedule at all.
      const legacySourceIds = copies
        .filter((copy) => (copy.entryModule?.slots.length ?? 0) === 0 && copy.sourceClassGroupId !== null)
        .map((copy) => copy.sourceClassGroupId!);
      const legacySchedules = new Map(
        legacySourceIds.length === 0
          ? []
          : (
              await tx
                .select({ id: classGroups.id, schedule: classGroups.schedule })
                .from(classGroups)
                .where(inArray(classGroups.id, legacySourceIds))
            ).map((row) => [row.id, row.schedule] as const),
      );

      await tx
        .insert(classGroups)
        .values(copies.map((copy) => insertValues(copy, legacySchedules.get(copy.sourceClassGroupId ?? "") ?? "")));
      const runs = copies.flatMap((copy) => copy.modules.map(moduleValues));
      if (runs.length > 0) await tx.insert(classGroupModules).values(runs);
    });
  }
}
