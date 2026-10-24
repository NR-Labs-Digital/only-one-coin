import { auditLog, classGroups, enrollments, students } from "@ooc/db";
import { and, asc, desc, eq, ilike, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import type { Db } from "@/infra/db/client.js";
import { CURRENT_CLASS_GROUP_STATUSES } from "@/infra/persistence/enrollment/ListEnrollmentsQuery.js";

/**
 * Who the student is to the institution today (OOC-116), derived from their
 * seats — still no column, as the schema documents:
 *
 * - `active` — at least one current enrollment: a confirmed seat in a class
 *   group still enrolling or in progress, the same "current" as the
 *   enrollment ledger's default tab (OOC-115).
 * - `former` — had a confirmed seat, none current. A class group that
 *   finishes moves its students here with no write anywhere.
 * - `under_review` — nothing confirmed, a seat still reserved. Settled in
 *   Payments, so only the pickers ever show it (OOC-55).
 * - `no_enrollment` — nothing confirmed or reserved: registered by hand, or
 *   every seat handed back.
 *
 * Until OOC-116 a confirmed seat meant "active" forever, which is why the
 * directory and the enrollment ledger read as the same list.
 */
export type StudentStatus = "active" | "former" | "under_review" | "no_enrollment";

export function deriveStudentStatus(seats: { confirmed: number; current: number; reserved: number }): StudentStatus {
  if (seats.current > 0) return "active";
  if (seats.confirmed > 0) return "former";
  if (seats.reserved > 0) return "under_review";
  return "no_enrollment";
}

/** `class_groups.status` values that make a confirmed seat current, as SQL. */
export const currentClassGroupSql = inArray(classGroups.status, CURRENT_CLASS_GROUP_STATUSES);

// Same "full years, not calendar years" rule the public checkout already
// uses (apps/app/src/lib/enrollment/checkout.ts, ageFrom/isMinor) — kept in
// sync by hand since apps/app has no Postgres credential to compute this
// server-side itself (CLAUDE.md §8).
export function isMinor(birthDate: Date, now = new Date()): boolean {
  let age = now.getUTCFullYear() - birthDate.getUTCFullYear();
  const hasHadBirthdayThisYear =
    now.getUTCMonth() > birthDate.getUTCMonth() ||
    (now.getUTCMonth() === birthDate.getUTCMonth() && now.getUTCDate() >= birthDate.getUTCDate());
  if (!hasHadBirthdayThisYear) age -= 1;

  return age < 18;
}

export interface StudentListRow {
  id: string;
  firstName: string;
  lastName: string;
  nationalIdType: string;
  nationalId: string;
  email: string;
  phone: string;
  birthDate: Date;
  country: string;
  region: string | null;
  city: string;
  createdAt: Date;
  isMinor: boolean;
  status: StudentStatus;
  /** Current enrollments — what `active` counts. */
  activeCourses: number;
  totalEnrollments: number;
  lastActivityAt: Date;
}

/** The manual enrollment and waitlist pickers only ever need a short match list. */
const SEARCH_LIMIT = 10;

/** One screen of the directory (`students-table.tsx` shows exactly this many). */
export const DIRECTORY_PAGE_SIZE = 15;

/**
 * Opaque `(created_at, id)` cursor at full microsecond precision. The
 * directory pages by offset now (OOC-76); the student file's activity
 * timeline still walks `audit_log` with it (`StudentActivityQuery`).
 */
export interface StudentListCursor {
  /**
   * UTC timestamp at full microsecond precision, as `to_char` renders it —
   * never a JS `Date`. `created_at` has no explicit column precision, so
   * Postgres keeps microseconds, but `Date` (and `Date#toISOString()`) only
   * carries milliseconds. A cursor built from a truncated `Date` can land
   * mid-microsecond inside a tie (e.g. a bulk import whose rows share one
   * `now()`), where neither `<` nor `=` matches the real column value —
   * pagination stalls there instead of advancing. Round-tripping the raw text
   * keeps the boundary comparison exact.
   */
  createdAt: string;
  id: string;
}

export function encodeStudentCursor(cursor: StudentListCursor): string {
  return Buffer.from(`${cursor.createdAt}|${cursor.id}`, "utf8").toString("base64url");
}

/** Malformed/tampered input decodes to `null` rather than throwing — an
 * invalid cursor just restarts the listing from the top, same as if none had
 * been sent, instead of failing the request over a client-controlled string
 * that carries no authorization meaning of its own. */
export function decodeStudentCursor(raw: string): StudentListCursor | null {
  try {
    const decoded = Buffer.from(raw, "base64url").toString("utf8");
    const [createdAt, id] = decoded.split("|");
    if (!createdAt || !id || Number.isNaN(new Date(createdAt).getTime())) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

/** The directory's tabs — a student whose only seat is still reserved is
 * settled in Payments, not listed (OOC-55), so `under_review` has no tab. */
export type DirectoryStatus = Exclude<StudentStatus, "under_review">;

/**
 * What the reader narrowed the directory to (OOC-76). Every field optional —
 * absent means "all" — and every one applied by Postgres: with 30k students a
 * filter that only sees the loaded page answers the wrong question.
 */
export interface StudentDirectoryFilters {
  /** Partial name, document or phone — served by the trigram indexes. */
  q?: string;
  /** The tab. Absent means every listed student. */
  status?: DirectoryStatus;
  /** Only students under 18 today. */
  minor?: boolean;
  sort?: "newest" | "oldest";
  /** 1-based. */
  page?: number;
}

export interface StudentDirectoryPage {
  items: StudentListRow[];
  /** Students matching every filter, across every page. */
  total: number;
  page: number;
  pageSize: number;
  /**
   * How many students the search reaches per tab and chip, ignoring the tab
   * and the age filter themselves — so each says what choosing it would give.
   */
  counts: { all: number; active: number; former: number; noEnrollment: number; minors: number };
}

/** Rows per round trip of an export — one screen is 15, the whole base 30k+. */
export const EXPORT_BATCH_SIZE = 2000;

/** `audit_log.target_id` of a directory export: the directory, not a student. */
export const STUDENT_DIRECTORY_TARGET = "student_directory";

export interface StudentDirectoryExport {
  /** Students the filters matched when the export was recorded. */
  rowCount: number;
  batches: AsyncGenerator<StudentListRow[]>;
}

/**
 * Read-only, same reasoning as the rest of this folder for living outside
 * `packages/domain`: nothing here protects a business invariant, it only
 * shapes a read. Three readers, one join:
 *
 * - `directory` — the student directory (OOC-76). Search, status and age run
 *   in Postgres and the result pages by offset, like the enrollment ledger.
 *   It leaves out students whose only enrollments are still reserved: they
 *   are being settled in Payments (OOC-55).
 * - `exportDirectory` — the same filters over every page, as a file
 *   (OOC-121). Its one write is its own `audit_log` entry, the same as a look
 *   at a receipt (`PaymentReceiptImageQuery`).
 * - `search` — the manual enrollment and waitlist pickers (CLAUDE.md §1, "a
 *   exceção, não um segundo caminho"): a short match list that still finds
 *   the student under review, so nobody registers the person twice.
 *
 * `status` is derived from the student's seats and the class groups they
 * sit in (`deriveStudentStatus`) — derived, not a stored column. It does not
 * know about payment or grading yet.
 */
export class ListStudentsQuery {
  constructor(private readonly db: Db) {}

  /** Per-student enrollment figures, retired enrollments left out (CLAUDE.md §6).
   * A retired class group still counts — its seats happened, the same rule as
   * the enrollment ledger. `scope` narrows the students aggregated — the
   * whole base costs a pass over every enrollment, which only the directory's
   * counters actually need. */
  private enrollmentStats(scope?: SQL) {
    return this.db
      .select({
        studentId: enrollments.studentId,
        total: sql<number>`count(*)`.mapWith(Number).as("total"),
        confirmed: sql<number>`count(*) filter (where ${enrollments.seatStatus} = 'confirmed')`
          .mapWith(Number)
          .as("confirmed"),
        current: sql<number>`count(*) filter (where ${enrollments.seatStatus} = 'confirmed' and ${currentClassGroupSql})`
          .mapWith(Number)
          .as("current"),
        reserved: sql<number>`count(*) filter (where ${enrollments.seatStatus} = 'reserved')`
          .mapWith(Number)
          .as("reserved"),
        lastAt: sql<Date | null>`max(${enrollments.updatedAt})`.as("last_at"),
      })
      .from(enrollments)
      .innerJoin(classGroups, eq(classGroups.id, enrollments.classGroupId))
      .where(and(isNull(enrollments.deletedAt), scope))
      .groupBy(enrollments.studentId)
      .as("stats");
  }

  /**
   * What the directory's filters mean in SQL — shared by the screen and the
   * export (OOC-121), so the file holds exactly who the tab, the search and
   * the chip listed. `base` is the search alone, which is what the counters
   * see; `narrowed` adds the tab and the age filter.
   */
  private directoryScope(filters: Omit<StudentDirectoryFilters, "page">) {
    const stats = this.enrollmentStats();

    const confirmed = sql`coalesce(${stats.confirmed}, 0)`;
    const current = sql`coalesce(${stats.current}, 0)`;
    const reserved = sql`coalesce(${stats.reserved}, 0)`;
    // `deriveStudentStatus` in SQL; the reserved-only students are already
    // out of `base`.
    const isActive = sql`${current} > 0`;
    const isFormer = sql`${current} = 0 and ${confirmed} > 0`;
    const isNoEnrollment = sql`${confirmed} = 0`;
    const tabSql = (status: DirectoryStatus | undefined) =>
      status === "active" ? isActive : status === "former" ? isFormer : status === "no_enrollment" ? isNoEnrollment : sql`true`;
    // Under 18 today, in UTC — the same rule `isMinor` applies in JS.
    const isMinorSql = sql`${students.birthDate} > ((now() at time zone 'UTC')::date - interval '18 years')`;

    const base: SQL[] = [
      isNull(students.deletedAt),
      // OOC-55: a student whose only seats are still reserved is settled in Payments.
      sql`not (${confirmed} = 0 and ${reserved} > 0)`,
    ];
    const q = filters.q?.trim();
    if (q) {
      const needle = `%${q}%`;
      base.push(
        or(
          ilike(sql`${students.firstName} || ' ' || ${students.lastName}`, needle),
          ilike(students.nationalId, needle),
          ilike(students.phone, needle),
        )!,
      );
    }

    const narrowed: SQL[] = [...base, tabSql(filters.status)];
    if (filters.minor) narrowed.push(isMinorSql);

    const columns = {
      id: students.id,
      firstName: students.firstName,
      lastName: students.lastName,
      nationalIdType: students.nationalIdType,
      nationalId: students.nationalId,
      email: students.email,
      phone: students.phone,
      birthDate: students.birthDate,
      country: students.country,
      region: students.region,
      city: students.city,
      createdAt: students.createdAt,
      updatedAt: students.updatedAt,
      totalEnrollments: sql<number>`coalesce(${stats.total}, 0)`.mapWith(Number),
      confirmedEnrollments: sql<number>`${confirmed}`.mapWith(Number),
      currentEnrollments: sql<number>`${current}`.mapWith(Number),
      lastEnrollmentAt: stats.lastAt,
    };

    return { stats, base, narrowed, columns, tabSql, isMinorSql, isActive, isFormer, isNoEnrollment };
  }

  async directory(filters: StudentDirectoryFilters = {}): Promise<StudentDirectoryPage> {
    const page = Math.max(1, Math.floor(filters.page ?? 1));
    const { stats, base, narrowed, columns, tabSql, isMinorSql, isActive, isFormer, isNoEnrollment } =
      this.directoryScope(filters);

    const rowsPromise = this.db
      .select(columns)
      .from(students)
      .leftJoin(stats, eq(stats.studentId, students.id))
      .where(and(...narrowed))
      .orderBy(
        ...(filters.sort === "oldest"
          ? [asc(students.createdAt), asc(students.id)]
          : [desc(students.createdAt), desc(students.id)]),
      )
      .limit(DIRECTORY_PAGE_SIZE)
      .offset((page - 1) * DIRECTORY_PAGE_SIZE);

    // One pass for the total and every tab and chip: those ignore the tab and
    // the age filter (they are the choice), the total honours them.
    const minorFilterSql = filters.minor ? isMinorSql : sql`true`;
    const countsPromise = this.db
      .select({
        total: sql<number>`count(*) filter (where ${tabSql(filters.status)} and ${minorFilterSql})`.mapWith(Number),
        all: sql<number>`count(*)`.mapWith(Number),
        active: sql<number>`count(*) filter (where ${isActive})`.mapWith(Number),
        former: sql<number>`count(*) filter (where ${isFormer})`.mapWith(Number),
        noEnrollment: sql<number>`count(*) filter (where ${isNoEnrollment})`.mapWith(Number),
        minors: sql<number>`count(*) filter (where ${isMinorSql})`.mapWith(Number),
      })
      .from(students)
      .leftJoin(stats, eq(stats.studentId, students.id))
      .where(and(...base));

    const [rows, [counted]] = await Promise.all([rowsPromise, countsPromise]);

    return {
      items: rows.map((row) =>
        toListRow({ ...row, reservedEnrollments: 0 }),
      ),
      total: counted?.total ?? 0,
      page,
      pageSize: DIRECTORY_PAGE_SIZE,
      counts: {
        all: counted?.all ?? 0,
        active: counted?.active ?? 0,
        former: counted?.former ?? 0,
        noEnrollment: counted?.noEnrollment ?? 0,
        minors: counted?.minors ?? 0,
      },
    };
  }

  /**
   * The directory as a file (OOC-121): every student the same filters list,
   * not one page. Personal data leaving in bulk (Ley 29733), so the export
   * is written to `audit_log` before the first row is read — a download
   * cut halfway still happened. The entry keeps the tab, the age filter and
   * whether a search narrowed the list, never the search text: that is a
   * name or a document, and the trail is append-only (CLAUDE.md §8).
   *
   * The rows come in batches walked by the `(created_at, id)` cursor at full
   * microsecond precision, so 30k students are never one result set held in
   * memory, and the API answers other requests between batches.
   */
  async exportDirectory(
    filters: Omit<StudentDirectoryFilters, "page">,
    actorId: string,
  ): Promise<StudentDirectoryExport> {
    const { stats, narrowed } = this.directoryScope(filters);
    const [counted] = await this.db
      .select({ rows: sql<number>`count(*)`.mapWith(Number) })
      .from(students)
      .leftJoin(stats, eq(stats.studentId, students.id))
      .where(and(...narrowed));
    const rowCount = counted?.rows ?? 0;

    await this.db.insert(auditLog).values({
      actorId,
      action: "student.directory_exported",
      targetId: STUDENT_DIRECTORY_TARGET,
      metadata: {
        status: filters.status ?? "all",
        minor: filters.minor === true,
        searched: Boolean(filters.q?.trim()),
        sort: filters.sort ?? "newest",
        rowCount,
      },
    });

    return { rowCount, batches: this.exportBatches(filters) };
  }

  private async *exportBatches(filters: Omit<StudentDirectoryFilters, "page">): AsyncGenerator<StudentListRow[]> {
    const oldest = filters.sort === "oldest";
    let cursor: StudentListCursor | null = null;

    for (;;) {
      const { stats, narrowed, columns } = this.directoryScope(filters);
      const after: SQL | undefined = cursor
        ? oldest
          ? sql`(${students.createdAt}, ${students.id}) > (${cursor.createdAt}::timestamptz, ${cursor.id}::uuid)`
          : sql`(${students.createdAt}, ${students.id}) < (${cursor.createdAt}::timestamptz, ${cursor.id}::uuid)`
        : undefined;

      const rows = await this.db
        .select({
          ...columns,
          cursorAt: sql<string>`to_char(${students.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
        })
        .from(students)
        .leftJoin(stats, eq(stats.studentId, students.id))
        .where(and(...narrowed, after))
        .orderBy(
          ...(oldest ? [asc(students.createdAt), asc(students.id)] : [desc(students.createdAt), desc(students.id)]),
        )
        .limit(EXPORT_BATCH_SIZE);

      if (rows.length > 0) yield rows.map((row) => toListRow({ ...row, reservedEnrollments: 0 }));
      if (rows.length < EXPORT_BATCH_SIZE) return;

      const last: { cursorAt: string; id: string } = rows[rows.length - 1]!;
      cursor = { createdAt: last.cursorAt, id: last.id };
    }
  }

  /** The pickers' short match list — by partial name or document, under review included. */
  async search(q: string): Promise<StudentListRow[]> {
    const needle = `%${q.trim()}%`;
    const matching = and(
      isNull(students.deletedAt),
      or(ilike(sql`${students.firstName} || ' ' || ${students.lastName}`, needle), ilike(students.nationalId, needle)),
    );
    // Ten rows come back, so only their enrollments are aggregated — not
    // every student's, on every keystroke of the picker.
    const matched = this.db
      .select({ id: students.id })
      .from(students)
      .where(matching)
      .orderBy(desc(students.createdAt), desc(students.id))
      .limit(SEARCH_LIMIT);
    const stats = this.enrollmentStats(inArray(enrollments.studentId, matched));

    const rows = await this.db
      .select({
        id: students.id,
        firstName: students.firstName,
        lastName: students.lastName,
        nationalIdType: students.nationalIdType,
        nationalId: students.nationalId,
        email: students.email,
        phone: students.phone,
        birthDate: students.birthDate,
        country: students.country,
        region: students.region,
        city: students.city,
        createdAt: students.createdAt,
        updatedAt: students.updatedAt,
        totalEnrollments: sql<number>`coalesce(${stats.total}, 0)`.mapWith(Number),
        confirmedEnrollments: sql<number>`coalesce(${stats.confirmed}, 0)`.mapWith(Number),
        currentEnrollments: sql<number>`coalesce(${stats.current}, 0)`.mapWith(Number),
        reservedEnrollments: sql<number>`coalesce(${stats.reserved}, 0)`.mapWith(Number),
        lastEnrollmentAt: stats.lastAt,
      })
      .from(students)
      .leftJoin(stats, eq(stats.studentId, students.id))
      .where(matching)
      .orderBy(desc(students.createdAt), desc(students.id))
      .limit(SEARCH_LIMIT);

    return rows.map(toListRow);
  }
}

function toListRow(row: {
  id: string;
  firstName: string;
  lastName: string;
  nationalIdType: string;
  nationalId: string;
  email: string;
  phone: string;
  birthDate: Date;
  country: string;
  region: string | null;
  city: string;
  createdAt: Date;
  updatedAt: Date;
  totalEnrollments: number;
  confirmedEnrollments: number;
  currentEnrollments: number;
  reservedEnrollments: number;
  lastEnrollmentAt: Date | string | null;
}): StudentListRow {
  const status = deriveStudentStatus({
    confirmed: row.confirmedEnrollments,
    current: row.currentEnrollments,
    reserved: row.reservedEnrollments,
  });
  // A raw `max()` out of a subquery can come back as text from the driver.
  const lastEnrollmentAt = row.lastEnrollmentAt === null ? null : new Date(row.lastEnrollmentAt);
  const lastActivityAt = lastEnrollmentAt && lastEnrollmentAt > row.updatedAt ? lastEnrollmentAt : row.updatedAt;

  return {
    id: row.id,
    firstName: row.firstName,
    lastName: row.lastName,
    nationalIdType: row.nationalIdType,
    nationalId: row.nationalId,
    email: row.email,
    phone: row.phone,
    birthDate: row.birthDate,
    country: row.country,
    region: row.region,
    city: row.city,
    createdAt: row.createdAt,
    isMinor: isMinor(row.birthDate),
    status,
    activeCourses: row.currentEnrollments,
    totalEnrollments: row.totalEnrollments,
    lastActivityAt,
  };
}
