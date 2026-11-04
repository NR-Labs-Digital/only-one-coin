import { sql } from "drizzle-orm";
import type { Db } from "@/infra/db/client.js";
import { decodeStudentCursor, encodeStudentCursor } from "./ListStudentsQuery.js";

/**
 * What the screen calls each `audit_log` action. The stored names are
 * dotted (`payment.approved`) and say where the write came from; the screen
 * gets a closed union it can translate (CLAUDE.md §4) — an action missing
 * here never reaches it.
 */
const ACTIONS = {
  "student.registered": "student_registered",
  "student.updated": "student_updated",
  "student.guardian_added": "guardian_added",
  "student.guardian_updated": "guardian_updated",
  "enrollment.created": "enrollment_created",
  "payment.approved": "payment_approved",
  "payment.rejected": "payment_rejected",
  "payment.receipt_viewed": "receipt_viewed",
} as const;

export type StudentActivityAction = (typeof ACTIONS)[keyof typeof ACTIONS];

/** Entity field names as the screen's field labels know them. */
const FIELDS: Record<string, StudentActivityField> = {
  firstName: "first_name",
  lastName: "last_name",
  nationalIdType: "id_type",
  nationalId: "id_number",
  email: "email",
  phone: "phone",
  birthDate: "birth_date",
  country: "country",
  region: "region",
  city: "city",
  relationship: "relationship",
};

export type StudentActivityField =
  | "first_name"
  | "last_name"
  | "id_type"
  | "id_number"
  | "email"
  | "phone"
  | "birth_date"
  | "country"
  | "region"
  | "city"
  | "relationship";

export type StudentActivityReference =
  | { kind: "course"; name: string }
  | { kind: "operation"; number: string }
  | { kind: "fields"; fields: StudentActivityField[] };

export interface StudentActivityRow {
  id: string;
  at: Date;
  action: StudentActivityAction;
  /** Null when the account behind the entry is gone — the log outlives it. */
  actorName: string | null;
  actorRole: string | null;
  reference: StudentActivityReference | null;
}

export interface StudentActivityPage {
  items: StudentActivityRow[];
  nextCursor: string | null;
}

// node-postgres through `db.execute()` returns timestamptz as strings.
interface RawActivityRow extends Record<string, unknown> {
  id: string;
  createdAt: string;
  createdAtCursor: string;
  action: keyof typeof ACTIONS;
  metadata: { fields?: unknown } | null;
  actorName: string | null;
  actorRole: string | null;
  courseName: string | null;
  operationNumber: string | null;
}

/** A student file's timeline is read a screen at a time — an old student piles up rows. */
export const ACTIVITY_PAGE_SIZE = 20;

/**
 * The student file's activity tab (OOC-75): every `audit_log` entry about
 * this person — written against the student, against one of their
 * enrollments, or against a payment of one of those — newest first, with who
 * did it.
 *
 * Read-only and outside `packages/domain` like the rest of this folder. Paged
 * by the same `(created_at, id)` cursor as the directory, at full microsecond
 * precision. `audit_log_target_id_idx` serves the `target_id in (...)`.
 */
export class StudentActivityQuery {
  constructor(private readonly db: Db) {}

  async run(studentId: string, cursor?: string): Promise<StudentActivityPage> {
    const decoded = cursor ? decodeStudentCursor(cursor) : null;
    const cursorFilter = decoded
      ? sql`and (a."created_at" < ${decoded.createdAt}::timestamptz
             or (a."created_at" = ${decoded.createdAt}::timestamptz and a."id" < ${decoded.id}::uuid))`
      : sql``;
    const actions = Object.keys(ACTIONS);

    const result = await this.db.execute<RawActivityRow>(sql`
      with targets as (
        select ${studentId}::text as id
        union all
        select e."id"::text from "enrollments" e where e."student_id" = ${studentId}::uuid
        union all
        select p."id"::text
          from "payments" p
          left join "procedure_requests" r on r."id" = p."procedure_request_id"
          join "enrollments" e on e."id" = coalesce(p."enrollment_id", r."enrollment_id")
         where e."student_id" = ${studentId}::uuid
      )
      select
        a."id" as "id",
        a."created_at" as "createdAt",
        to_char(a."created_at" at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "createdAtCursor",
        a."action" as "action",
        a."metadata" as "metadata",
        actor."name" as "actorName",
        actor."role" as "actorRole",
        c."name" as "courseName",
        pay."operation_number" as "operationNumber"
      from "audit_log" a
      left join "user" actor on actor."id" = a."actor_id"
      left join "payments" pay on pay."id"::text = a."target_id"
      left join "procedure_requests" req on req."id" = pay."procedure_request_id"
      left join "enrollments" enr on enr."id"::text = coalesce(pay."enrollment_id"::text, req."enrollment_id"::text, a."target_id")
      left join "class_groups" cg on cg."id" = enr."class_group_id"
      left join "courses" c on c."id" = cg."course_id"
      where a."target_id" in (select id from targets)
        and a."action" in (${sql.join(
          actions.map((action) => sql`${action}`),
          sql`, `,
        )})
        ${cursorFilter}
      order by a."created_at" desc, a."id" desc
      limit ${ACTIVITY_PAGE_SIZE + 1}
    `);

    const rows = result.rows;
    const hasMore = rows.length > ACTIVITY_PAGE_SIZE;
    const page = hasMore ? rows.slice(0, ACTIVITY_PAGE_SIZE) : rows;
    const last = page[page.length - 1];

    return {
      items: page.map((row) => ({
        id: row.id,
        at: new Date(row.createdAt),
        action: ACTIONS[row.action],
        actorName: row.actorName?.trim() || null,
        actorRole: row.actorRole,
        reference: referenceOf(row),
      })),
      nextCursor: hasMore && last ? encodeStudentCursor({ createdAt: last.createdAtCursor, id: last.id }) : null,
    };
  }
}

/** The one detail worth a line under the entry. Values never come from the log. */
function referenceOf(row: RawActivityRow): StudentActivityReference | null {
  if (row.action === "student.updated" || row.action === "student.guardian_updated") {
    const raw = Array.isArray(row.metadata?.fields) ? (row.metadata.fields as unknown[]) : [];
    const fields = raw.flatMap((field) => (typeof field === "string" && FIELDS[field] ? [FIELDS[field]] : []));
    return fields.length > 0 ? { kind: "fields", fields } : null;
  }
  if (row.action.startsWith("payment.") && row.operationNumber) {
    return { kind: "operation", number: row.operationNumber };
  }
  return row.courseName ? { kind: "course", name: row.courseName } : null;
}
