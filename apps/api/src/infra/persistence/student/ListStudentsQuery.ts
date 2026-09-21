import { enrollments, students } from "@ooc/db";
import { and, desc, eq, ilike, isNull, lt, or, sql } from "drizzle-orm";
import type { Db } from "@/infra/db/client.js";

export type StudentStatus = "active" | "under_review" | "inactive";

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
  activeCourses: number;
  totalEnrollments: number;
  lastActivityAt: Date;
}

// The no-`q` directory listing is cursor-paginated (created_at, id) DESC —
// `id` breaks ties since a bulk import can insert many rows in the same
// statement-second (a real DEFAULT NOW() collision, not a hypothetical one).
// `q` stays a small, non-paginated cap: it backs the manual enrollment
// form's picker (CLAUDE.md §1), which only ever needs a short match list, not
// a directory browse.
const PAGE_SIZE = 50;
const SEARCH_LIMIT = 10;

export interface StudentListCursor {
  createdAt: Date;
  id: string;
}

export function encodeStudentCursor(cursor: StudentListCursor): string {
  return Buffer.from(`${cursor.createdAt.toISOString()}|${cursor.id}`, "utf8").toString("base64url");
}

/** Malformed/tampered input decodes to `null` rather than throwing — an
 * invalid cursor just restarts the listing from the top, same as if none had
 * been sent, instead of failing the request over a client-controlled string
 * that carries no authorization meaning of its own. */
export function decodeStudentCursor(raw: string): StudentListCursor | null {
  try {
    const decoded = Buffer.from(raw, "base64url").toString("utf8");
    const [isoDate, id] = decoded.split("|");
    if (!isoDate || !id) return null;
    const createdAt = new Date(isoDate);
    if (Number.isNaN(createdAt.getTime())) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

export interface StudentListPage {
  items: StudentListRow[];
  nextCursor: string | null;
  /**
   * How many live students there are in total — counted on the first page of
   * a directory browse only. Null for a `q` search (a capped match list with
   * nothing to page) and null for any page reached by cursor, where recounting
   * would buy a stale-proof number nobody asked for at the price of a second
   * round trip per page.
   *
   * It is what lets the pager offer pages whose rows have not been fetched:
   * without it the screen could only page what it already held, so "next" on
   * the last of 50 rows did nothing with 250 more behind the cursor.
   */
  total: number | null;
}

/**
 * Read-only, same reasoning as the rest of this folder for living outside
 * `packages/domain`: nothing here protects a business invariant, it only
 * shapes a read. Serves both the student directory (no `q`) and the manual
 * enrollment form's picker (`q` set — CLAUDE.md §1, "a exceção, não um
 * segundo caminho") off the same query, since the underlying join is
 * identical either way.
 *
 * `status` is derived from `seatStatus` across the student's enrollments —
 * confirmed beats reserved beats "none of the above" — matching the schema
 * comment on `students.ts` ("derived, not a stored column"). This is a
 * first-pass rule: it does not know about payment or grading yet, since
 * neither is queried here, so a student who paid but whose seat hasn't
 * flipped to `confirmed` still reads `under_review`.
 */
export class ListStudentsQuery {
  constructor(private readonly db: Db) {}

  async run(q?: string, cursor?: string): Promise<StudentListPage> {
    const needle = q ? `%${q}%` : null;
    // Cursor pagination only applies to the directory browse — a search
    // already returns a short, non-paginated list.
    const decodedCursor = !needle && cursor ? decodeStudentCursor(cursor) : null;
    const limit = needle ? SEARCH_LIMIT : PAGE_SIZE;

    const baseFilter = needle
      ? and(
          isNull(students.deletedAt),
          or(ilike(sql`${students.firstName} || ' ' || ${students.lastName}`, needle), ilike(students.nationalId, needle)),
        )
      : isNull(students.deletedAt);

    const cursorFilter = decodedCursor
      ? or(
          lt(students.createdAt, decodedCursor.createdAt),
          and(eq(students.createdAt, decodedCursor.createdAt), lt(students.id, decodedCursor.id)),
        )
      : undefined;

    /* Counted on the first page of a browse, and nowhere else — see `total`
       on StudentListPage. Started here rather than awaited after the rows,
       because the two ask different questions of different indexes and
       neither needs the other's answer: sequentially they cost two round
       trips (~280ms against a managed Postgres), together they cost one. */
    const totalPromise =
      !needle && !cursor
        ? this.db
            .select({ value: sql<number>`count(*)`.mapWith(Number) })
            .from(students)
            .where(isNull(students.deletedAt))
        : null;

    const rowsPromise = this.db
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
        totalEnrollments: sql<number>`count(${enrollments.id})`.mapWith(Number),
        confirmedEnrollments:
          sql<number>`count(${enrollments.id}) filter (where ${enrollments.seatStatus} = 'confirmed')`.mapWith(
            Number,
          ),
        reservedEnrollments:
          sql<number>`count(${enrollments.id}) filter (where ${enrollments.seatStatus} = 'reserved')`.mapWith(
            Number,
          ),
        lastEnrollmentAt: sql<Date | null>`max(${enrollments.updatedAt})`,
      })
      .from(students)
      .leftJoin(enrollments, eq(enrollments.studentId, students.id))
      .where(cursorFilter ? and(baseFilter, cursorFilter) : baseFilter)
      .groupBy(students.id)
      .orderBy(desc(students.createdAt), desc(students.id))
      // Fetch one extra row to learn whether another page follows, without
      // a second round-trip — sliced back off before mapping to output.
      .limit(limit + 1);

    const [rows, counted] = await Promise.all([rowsPromise, totalPromise]);

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor =
      !needle && hasMore ? encodeStudentCursor({ createdAt: page[page.length - 1]!.createdAt, id: page[page.length - 1]!.id }) : null;

    const items = page.map((row): StudentListRow => {
      const status: StudentStatus =
        row.confirmedEnrollments > 0 ? "active" : row.reservedEnrollments > 0 ? "under_review" : "inactive";

      const lastActivityAt =
        row.lastEnrollmentAt && row.lastEnrollmentAt > row.updatedAt ? row.lastEnrollmentAt : row.updatedAt;

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
        activeCourses: row.confirmedEnrollments,
        totalEnrollments: row.totalEnrollments,
        lastActivityAt,
      };
    });

    const total = counted ? (counted[0]?.value ?? 0) : null;

    return { items, nextCursor, total };
  }
}
