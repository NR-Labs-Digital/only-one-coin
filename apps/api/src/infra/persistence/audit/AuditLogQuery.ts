import {
  AUDIT_ACTIONS,
  AUDIT_FIELDS,
  CATALOG_KIND_ENTITY,
  auditEntityOf,
  auditFieldsOf,
  storedActionsOf,
  type AuditActionKey,
  type AuditEntity,
  type AuditField,
  type AuditStoredAction,
  type AuditSubject,
} from "@ooc/domain";
import {
  academicPeriods,
  auditLog,
  classGroups,
  courses,
  enrollments,
  payments,
  plans,
  students,
  teachers,
} from "@ooc/db";
import { eq, inArray, sql, type SQL } from "drizzle-orm";
import type { Db } from "@/infra/db/client.js";
import { decodeStudentCursor, encodeStudentCursor } from "@/infra/persistence/student/ListStudentsQuery.js";

/** One screen of the general log. */
export const AUDIT_LOG_PAGE_SIZE = 50;

/** Rows per round trip of an export. */
export const AUDIT_EXPORT_BATCH_SIZE = 1000;

/** `audit_log.target_id` of an export of the log itself. */
export const AUDIT_LOG_TARGET = "audit_log";

/**
 * What the reader narrowed the log to. Every field optional — absent means
 * "all" — and every one applied by Postgres.
 */
export interface AuditLogFilters {
  /** First day, `YYYY-MM-DD`, as a calendar day in America/Lima. */
  from?: string;
  /** Last day, inclusive, same reading. */
  to?: string;
  /** The account that wrote the entry. */
  actorId?: string;
  action?: Exclude<AuditActionKey, "unknown">;
  entity?: AuditEntity;
}

/**
 * The record an entry is about, when it still exists and has something to
 * name it by. `label` is what the screen prints: a person's or a course's
 * name, a class group's code, a payment's operation number.
 */
export interface AuditLogSubject {
  entity: AuditEntity;
  id: string;
  label: string;
}

export interface AuditLogRow {
  id: string;
  at: Date;
  action: AuditActionKey;
  entity: AuditEntity | null;
  subject: AuditLogSubject | null;
  /** Names of what changed — never the values (CLAUDE.md §8, OOC-74). */
  fields: AuditField[];
  /** Null when the account behind the entry is gone — the log outlives it. */
  actor: { id: string; name: string | null; role: string | null } | null;
}

export interface AuditLogPage {
  items: AuditLogRow[];
  nextCursor: string | null;
}

export interface AuditLogExport {
  rowCount: number;
  batches: AsyncGenerator<AuditLogRow[]>;
}

export interface AuditActorOption {
  id: string;
  name: string;
  role: string;
}

// node-postgres through `db.execute()` returns timestamptz as strings.
interface RawEntry extends Record<string, unknown> {
  id: string;
  createdAt: string;
  cursorAt: string;
  action: string;
  targetId: string;
  fields: unknown;
  catalogKind: string | null;
  metaStudentId: string | null;
  metaClassGroupId: string | null;
  actorId: string;
  actorName: string | null;
  actorRole: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const RETIRE_RESTORE: AuditStoredAction[] = ["catalog.retired", "catalog.restored"];

function list(values: readonly string[]): SQL {
  return sql.join(
    values.map((value) => sql`${value}`),
    sql`, `,
  );
}

/** The filters as one SQL condition over `audit_log a`. */
function whereOf(filters: AuditLogFilters): SQL {
  const parts: SQL[] = [];
  // A calendar day in Lima, the timezone every screen renders in (CLAUDE.md §6).
  if (filters.from) parts.push(sql`a."created_at" >= (${filters.from}::date::timestamp at time zone 'America/Lima')`);
  if (filters.to) parts.push(sql`a."created_at" < ((${filters.to}::date + 1)::timestamp at time zone 'America/Lima')`);
  if (filters.actorId) parts.push(sql`a."actor_id" = ${filters.actorId}`);
  if (filters.action) parts.push(sql`a."action" in (${list(storedActionsOf(filters.action))})`);
  if (filters.entity) {
    const entity = filters.entity;
    const fixed = (Object.keys(AUDIT_ACTIONS) as AuditStoredAction[]).filter(
      (action) => AUDIT_ACTIONS[action].entity === entity,
    );
    const kinds = Object.entries(CATALOG_KIND_ENTITY)
      .filter(([, of]) => of === entity)
      .map(([kind]) => kind);
    const byKind = kinds.length > 0 ? sql`(a."action" in (${list(RETIRE_RESTORE)}) and a."metadata"->>'kind' in (${list(kinds)}))` : null;
    const byAction = fixed.length > 0 ? sql`a."action" in (${list(fixed)})` : null;
    parts.push(byAction && byKind ? sql`(${byAction} or ${byKind})` : (byAction ?? byKind ?? sql`false`));
  }
  return parts.length > 0 ? sql.join(parts, sql` and `) : sql`true`;
}

/** Which kind of record to look the entry's subject up in, and by which id. */
type Lookup =
  | { kind: "student" | "payment" | "class_group" | "course" | "plan" | "academic_period" | "teacher"; id: string }
  | { kind: "student_account" | "staff"; id: string };

function lookupOf(row: RawEntry): Lookup | null {
  const entry = (AUDIT_ACTIONS as Record<string, { entity: AuditEntity | null; subject: AuditSubject }>)[row.action];
  if (!entry) return null;

  switch (entry.subject) {
    case "none":
      return null;
    case "metadata_student":
      return row.metaStudentId ? { kind: "student", id: row.metaStudentId } : null;
    case "metadata_class_group":
      return row.metaClassGroupId ? { kind: "class_group", id: row.metaClassGroupId } : null;
    case "student_account":
      return { kind: "student_account", id: row.targetId };
    case "plan":
      return { kind: "plan", id: row.targetId };
    case "catalog_kind":
      return row.catalogKind === "academic_period" ||
        row.catalogKind === "course" ||
        row.catalogKind === "plan" ||
        row.catalogKind === "class_group"
        ? { kind: row.catalogKind, id: row.targetId }
        : null;
    case "target":
      if (entry.entity === "staff") return { kind: "staff", id: row.targetId };
      if (entry.entity === "platform" || entry.entity === null) return null;
      return { kind: entry.entity, id: row.targetId };
  }
}

const fullName = (first: string, last: string) => `${first} ${last}`.trim();

/**
 * The general audit log (OOC-122): every entry, newest first, filtered by
 * period, author, action and entity — read-only, like the student file's
 * activity tab (`StudentActivityQuery`) and the cargo ledger, which show
 * slices of the same trail.
 *
 * An entry shows what it is about through the catalogue
 * (`@ooc/domain`, `auditCatalog.ts`), and the record behind it is looked up a
 * page at a time — one query per kind of record on the page, never one per
 * row. A record that no longer exists, or whose id is not one (an invite,
 * a setting), is no subject: the screen names the entity and links nothing.
 *
 * Paged by the `(created_at, id)` cursor at full microsecond precision
 * (`audit_log_created_at_id_idx`, migration 0034).
 */
export class AuditLogQuery {
  constructor(private readonly db: Db) {}

  async page(filters: AuditLogFilters, cursor?: string): Promise<AuditLogPage> {
    const decoded = cursor ? decodeStudentCursor(cursor) : null;
    const rows = await this.read(filters, decoded, AUDIT_LOG_PAGE_SIZE + 1);
    const hasMore = rows.length > AUDIT_LOG_PAGE_SIZE;
    const page = hasMore ? rows.slice(0, AUDIT_LOG_PAGE_SIZE) : rows;
    const last = page[page.length - 1];

    return {
      items: await this.shape(page),
      nextCursor: hasMore && last ? encodeStudentCursor({ createdAt: last.cursorAt, id: last.id }) : null,
    };
  }

  /**
   * The log as a file. Taking the trail away is itself an entry, written
   * before the first row is read — a download cut halfway still happened.
   */
  async export(filters: AuditLogFilters, actorId: string): Promise<AuditLogExport> {
    const counted = await this.db.execute<{ rows: string }>(
      sql`select count(*) as "rows" from "audit_log" a where ${whereOf(filters)}`,
    );
    const rowCount = Number(counted.rows[0]?.rows ?? 0);

    await this.db.insert(auditLog).values({
      actorId,
      action: "audit_log.exported",
      targetId: AUDIT_LOG_TARGET,
      metadata: {
        from: filters.from ?? null,
        to: filters.to ?? null,
        actorId: filters.actorId ?? null,
        action: filters.action ?? null,
        entity: filters.entity ?? null,
        rowCount,
      },
    });

    return { rowCount, batches: this.exportBatches(filters) };
  }

  /** Every panel account that can have written an entry, for the author filter. */
  async actors(): Promise<AuditActorOption[]> {
    const result = await this.db.execute<{ id: string; name: string; role: string }>(sql`
      select u."id" as "id", coalesce(nullif(trim(u."name"), ''), u."email") as "name", u."role" as "role"
      from "user" u
      where u."role" <> 'student'
      order by lower(u."name"), u."id"
    `);
    return result.rows;
  }

  private async *exportBatches(filters: AuditLogFilters): AsyncGenerator<AuditLogRow[]> {
    let cursor: { createdAt: string; id: string } | null = null;
    for (;;) {
      const rows = await this.read(filters, cursor, AUDIT_EXPORT_BATCH_SIZE);
      if (rows.length > 0) yield await this.shape(rows);
      if (rows.length < AUDIT_EXPORT_BATCH_SIZE) return;
      const last: RawEntry = rows[rows.length - 1]!;
      cursor = { createdAt: last.cursorAt, id: last.id };
    }
  }

  private async read(
    filters: AuditLogFilters,
    cursor: { createdAt: string; id: string } | null,
    limit: number,
  ): Promise<RawEntry[]> {
    const after = cursor
      ? sql`and (a."created_at", a."id") < (${cursor.createdAt}::timestamptz, ${cursor.id}::uuid)`
      : sql``;
    const result = await this.db.execute<RawEntry>(sql`
      select
        a."id" as "id",
        a."created_at" as "createdAt",
        to_char(a."created_at" at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "cursorAt",
        a."action" as "action",
        a."target_id" as "targetId",
        a."metadata"->'fields' as "fields",
        a."metadata"->>'kind' as "catalogKind",
        a."metadata"->>'studentId' as "metaStudentId",
        a."metadata"->>'classGroupId' as "metaClassGroupId",
        a."actor_id" as "actorId",
        actor."name" as "actorName",
        actor."role" as "actorRole"
      from "audit_log" a
      left join "user" actor on actor."id" = a."actor_id"
      where ${whereOf(filters)}
      ${after}
      order by a."created_at" desc, a."id" desc
      limit ${limit}
    `);
    return result.rows;
  }

  private async shape(rows: RawEntry[]): Promise<AuditLogRow[]> {
    const lookups = rows.map(lookupOf);
    const subjects = await this.resolve(lookups.filter((lookup): lookup is Lookup => lookup !== null));

    return rows.map((row, i) => {
      const entry = (AUDIT_ACTIONS as Record<string, { key: AuditActionKey }>)[row.action];
      const lookup = lookups[i];
      const setting = row.action.startsWith("platform_settings.") ? row.action.slice("platform_settings.".length) : null;
      const fields =
        setting && setting in AUDIT_FIELDS ? [AUDIT_FIELDS[setting as keyof typeof AUDIT_FIELDS]] : auditFieldsOf(row.fields);

      return {
        id: row.id,
        at: new Date(row.createdAt),
        action: entry?.key ?? "unknown",
        entity: auditEntityOf(row.action, row.catalogKind),
        subject: lookup ? (subjects.get(`${lookup.kind}:${lookup.id}`) ?? null) : null,
        fields,
        actor: row.actorId
          ? { id: row.actorId, name: row.actorName?.trim() || null, role: row.actorRole }
          : null,
      };
    });
  }

  /** One query per kind of record on the page. Keyed `kind:id`. */
  private async resolve(lookups: Lookup[]): Promise<Map<string, AuditLogSubject>> {
    const ids = (kind: Lookup["kind"], uuidOnly = true) => [
      ...new Set(lookups.filter((l) => l.kind === kind && (!uuidOnly || UUID.test(l.id))).map((l) => l.id)),
    ];
    const found = new Map<string, AuditLogSubject>();
    const put = (kind: Lookup["kind"], id: string, subject: AuditLogSubject) => found.set(`${kind}:${id}`, subject);
    const tasks: Promise<void>[] = [];

    const studentIds = ids("student");
    if (studentIds.length > 0) {
      tasks.push(
        this.db
          .select({ id: students.id, firstName: students.firstName, lastName: students.lastName })
          .from(students)
          .where(inArray(students.id, studentIds))
          .then((rows) => {
            for (const r of rows) put("student", r.id, { entity: "student", id: r.id, label: fullName(r.firstName, r.lastName) });
          }),
      );
    }

    const accountIds = ids("student_account", false);
    if (accountIds.length > 0) {
      tasks.push(
        this.db
          .select({ id: students.id, userId: students.userId, firstName: students.firstName, lastName: students.lastName })
          .from(students)
          .where(inArray(students.userId, accountIds))
          .then((rows) => {
            for (const r of rows) {
              if (r.userId) {
                put("student_account", r.userId, { entity: "student", id: r.id, label: fullName(r.firstName, r.lastName) });
              }
            }
          }),
      );
    }

    const paymentIds = ids("payment");
    if (paymentIds.length > 0) {
      tasks.push(
        this.db
          .select({
            id: payments.id,
            operationNumber: payments.operationNumber,
            firstName: students.firstName,
            lastName: students.lastName,
          })
          .from(payments)
          .innerJoin(enrollments, eq(enrollments.id, payments.enrollmentId))
          .innerJoin(students, eq(students.id, enrollments.studentId))
          .where(inArray(payments.id, paymentIds))
          .then((rows) => {
            for (const r of rows) {
              put("payment", r.id, { entity: "payment", id: r.id, label: r.operationNumber ?? fullName(r.firstName, r.lastName) });
            }
          }),
      );
    }

    const groupIds = ids("class_group");
    if (groupIds.length > 0) {
      tasks.push(
        this.db
          .select({ id: classGroups.id, code: classGroups.code, courseName: courses.name })
          .from(classGroups)
          .innerJoin(courses, eq(courses.id, classGroups.courseId))
          .where(inArray(classGroups.id, groupIds))
          .then((rows) => {
            for (const r of rows) put("class_group", r.id, { entity: "class_group", id: r.id, label: r.code || r.courseName });
          }),
      );
    }

    const courseIds = ids("course");
    if (courseIds.length > 0) {
      tasks.push(
        this.db
          .select({ id: courses.id, name: courses.name })
          .from(courses)
          .where(inArray(courses.id, courseIds))
          .then((rows) => {
            for (const r of rows) put("course", r.id, { entity: "course", id: r.id, label: r.name });
          }),
      );
    }

    const planIds = ids("plan");
    if (planIds.length > 0) {
      tasks.push(
        this.db
          .select({ id: plans.id, courseId: courses.id, courseName: courses.name })
          .from(plans)
          .innerJoin(courses, eq(courses.id, plans.courseId))
          .where(inArray(plans.id, planIds))
          .then((rows) => {
            for (const r of rows) put("plan", r.id, { entity: "course", id: r.courseId, label: r.courseName });
          }),
      );
    }

    const periodIds = ids("academic_period");
    if (periodIds.length > 0) {
      tasks.push(
        this.db
          .select({ id: academicPeriods.id, name: academicPeriods.name })
          .from(academicPeriods)
          .where(inArray(academicPeriods.id, periodIds))
          .then((rows) => {
            for (const r of rows) put("academic_period", r.id, { entity: "academic_period", id: r.id, label: r.name });
          }),
      );
    }

    const teacherIds = ids("teacher");
    if (teacherIds.length > 0) {
      tasks.push(
        this.db
          .select({ id: teachers.id, firstName: teachers.firstName, lastName: teachers.lastName })
          .from(teachers)
          .where(inArray(teachers.id, teacherIds))
          .then((rows) => {
            for (const r of rows) put("teacher", r.id, { entity: "teacher", id: r.id, label: fullName(r.firstName, r.lastName) });
          }),
      );
    }

    // Better Auth's own table, so raw SQL like the rest of identity; its ids are text.
    const staffIds = ids("staff", false);
    if (staffIds.length > 0) {
      tasks.push(
        this.db
          .execute<{ id: string; name: string | null }>(sql`select "id", "name" from "user" where "id" in (${list(staffIds)})`)
          .then((result) => {
            for (const r of result.rows) {
              const name = r.name?.trim();
              if (name) put("staff", r.id, { entity: "staff", id: r.id, label: name });
            }
          }),
      );
    }

    await Promise.all(tasks);
    return found;
  }
}
