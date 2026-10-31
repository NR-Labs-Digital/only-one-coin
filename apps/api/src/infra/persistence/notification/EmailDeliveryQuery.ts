import {
  STUDENT_DELIVERY_TEMPLATES,
  deliveryFailureReason,
  isResendableTemplate,
  parseDeliveryDedupeKey,
  type DeliveryFailureReason,
  type DeliveryRecipientKind,
  type StudentDeliveryTemplate,
} from "@ooc/domain";
import { sql, type SQL } from "drizzle-orm";
import type { Db } from "@/infra/db/client.js";

/** Rows on one screen. Failed rows are an errand list, not an archive — far
 * more than this is an incident, and the count still says how many. */
export const EMAIL_DELIVERY_LIST_LIMIT = 200;

/**
 * The student file an outbox row is about, read back from the subject its
 * dedupe key names — the outbox has no `student_id` (OOC-90). Each branch
 * casts the key's subject only for its own templates: the CASE is what keeps
 * a portal row's user id from ever reaching a `::uuid`, and it leaves the
 * comparison on the bare primary key, so each lookup is an index probe.
 *
 * `o` is the outbox row's alias in the query this goes into.
 */
export const deliveryStudentIdSql: SQL = sql`coalesce(
  (select e.student_id from enrollments e
    where e.id = case when o.template_key = 'enrollment_received'
                      then split_part(o.dedupe_key, ':', 2)::uuid end),
  (select e.student_id from payments p join enrollments e on e.id = p.enrollment_id
    where p.id = case when o.template_key in ('payment_under_review', 'payment_approved', 'payment_rejected')
                      then split_part(o.dedupe_key, ':', 2)::uuid end),
  (select s.id from students s
    where o.template_key in ('portal_credentials', 'portal_password_reset')
      and s.user_id = split_part(o.dedupe_key, ':', 2)
      and s.deleted_at is null
    order by s.created_at limit 1)
)`;

export interface EmailDeliveryIssue {
  id: string;
  template: StudentDeliveryTemplate;
  studentId: string | null;
  studentName: string | null;
  recipientKind: DeliveryRecipientKind;
  /** The address the failed row was written to. */
  address: string;
  reason: DeliveryFailureReason;
  /** The last attempt. */
  at: Date;
  attempts: number;
  resendable: boolean;
}

interface RawRow extends Record<string, unknown> {
  id: string;
  template_key: StudentDeliveryTemplate;
  dedupe_key: string;
  recipient: string;
  last_error: string | null;
  attempts: number;
  // node-postgres through `db.execute()` returns timestamptz as strings.
  updated_at: string;
  student_id: string | null;
  first_name: string | null;
  last_name: string | null;
  total: string;
}

/**
 * The undelivered e-mails screen (OOC-90): the outbox rows about a student
 * that ended `failed` and nobody resent yet, newest first. A resent row drops
 * off — its resend is the row that matters now, and it is listed in turn if
 * it fails too.
 */
export class EmailDeliveryQuery {
  constructor(private readonly db: Db) {}

  async list(filters: { template?: StudentDeliveryTemplate }): Promise<{ items: EmailDeliveryIssue[]; total: number }> {
    const templates = filters.template ? [filters.template] : STUDENT_DELIVERY_TEMPLATES;

    const result = await this.db.execute<RawRow>(sql`
      with issues as (
        select o.id, o.template_key, o.dedupe_key, o.recipient, o.last_error, o.attempts, o.updated_at,
               ${deliveryStudentIdSql} as student_id
          from outbox o
         where o.status = 'failed'
           and o.template_key in (${sql.join(
             templates.map((template) => sql`${template}`),
             sql`, `,
           )})
           and not exists (select 1 from outbox r where r.dedupe_key = o.dedupe_key || ':resend')
      )
      select i.*, s.first_name, s.last_name, count(*) over () as total
        from issues i
        left join students s on s.id = i.student_id
       order by i.updated_at desc, i.id
       limit ${EMAIL_DELIVERY_LIST_LIMIT}
    `);

    const rows = result.rows;
    return {
      total: rows[0] ? Number(rows[0].total) : 0,
      items: rows.map((row) => ({
        id: row.id,
        template: row.template_key,
        studentId: row.student_id,
        studentName: row.first_name === null ? null : `${row.first_name} ${row.last_name ?? ""}`.trim(),
        recipientKind: parseDeliveryDedupeKey(row.dedupe_key).recipientKind,
        address: row.recipient,
        reason: deliveryFailureReason(row.last_error),
        at: new Date(row.updated_at),
        attempts: row.attempts,
        resendable: isResendableTemplate(row.template_key),
      })),
    };
  }
}
