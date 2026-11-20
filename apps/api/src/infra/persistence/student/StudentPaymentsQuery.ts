import {
  isReceiptVerdict,
  PaymentMethodSchema,
  ProcedureKindSchema,
  RECEIPT_EXTRACTION_TIER_PRIMARY,
  type PaymentMethod,
  type ProcedureKind,
  type ReceiptVerdict,
} from "@ooc/domain";
import { sql } from "drizzle-orm";
import type { Db } from "@/infra/db/client.js";
import { lotExpectedExtraCents } from "@/infra/persistence/payment/paymentLot.js";

export type StudentPaymentStatus = "pending" | "under_review" | "approved" | "rejected";

export type StudentPaymentRejectionReason = "amount_mismatch" | "illegible" | "duplicate" | "not_a_receipt" | "other";

const REJECTION_REASONS: ReadonlySet<string> = new Set<StudentPaymentRejectionReason>([
  "amount_mismatch",
  "illegible",
  "duplicate",
  "not_a_receipt",
  "other",
]);

/** One payment a student sent a receipt for, as the file's Documents tab lists it (OOC-62). */
export interface StudentPaymentRow {
  id: string;
  /** null = the enrollment itself (or a later monthly module); a kind = that paid procedure. */
  procedureKind: ProcedureKind | null;
  /** The courses of THIS student the payment pays for — more than one when a lot covered several of them. */
  courseNames: string[];
  /** How many enrollments the payment pays for in all; above 1 is a lot (OOC-158), possibly with siblings. */
  enrollmentCount: number;
  status: StudentPaymentStatus;
  method: PaymentMethod;
  methodDetail: string | null;
  operationNumber: string | null;
  /** What the student declared they paid. */
  amountCents: number;
  /** The frozen price the payment is checked against — the whole lot's sum for a lot. */
  expectedAmountCents: number;
  /** What OCR read off the latest receipt (its latest answered re-read, if any); null when nothing was read. */
  readAmountCents: number | null;
  /** The traffic light on that same reading; null while it has not run. */
  verdict: ReceiptVerdict | null;
  rejectionReason: StudentPaymentRejectionReason | null;
  /** Whether a processed receipt image exists to be opened. */
  hasReceipt: boolean;
  submittedAt: Date;
  decidedAt: Date | null;
}

/**
 * Every payment on one student's file, newest first (OOC-62) — read-only, a
 * shaped join like the Payments ledger. A payment belongs here when it pays
 * for one of the student's enrollments (through `payment_coverage`, so the
 * second child of a lot sees the lot) or for a procedure of theirs. Retired
 * enrollments take their payments with them, as in Payments.
 *
 * The reading and verdict follow the review queue: the most recent upload
 * speaks for the payment, and its latest answered re-read speaks instead of
 * the first reading. No paging — one person's payments are a handful.
 */
export class StudentPaymentsQuery {
  constructor(private readonly db: Db) {}

  async run(studentId: string): Promise<StudentPaymentRow[]> {
    const result = await this.db.execute<{
      id: string;
      procedure_kind: string | null;
      course_names: string[];
      enrollment_count: number | string;
      status: string;
      method: string;
      method_detail: string | null;
      operation_number: string | null;
      amount_cents: number;
      expected_amount_cents: number | string;
      read_amount_cents: number | null;
      verdict: string | null;
      rejection_reason: string | null;
      has_receipt: boolean;
      created_at: Date | string;
      decided_at: Date | string | null;
    }>(sql`
      with own as (
        select pc.payment_id, e.id as enrollment_id
          from payment_coverage pc
          join enrollments e on e.id = pc.enrollment_id
         where e.student_id = ${studentId} and e.deleted_at is null
        union
        select p.id, e.id
          from payments p
          join procedure_requests pr on pr.id = p.procedure_request_id
          join enrollments e on e.id = pr.enrollment_id
         where pr.student_id = ${studentId} and e.deleted_at is null
      ),
      own_courses as (
        select own.payment_id, array_agg(distinct c.name order by c.name) as course_names
          from own
          join enrollments e on e.id = own.enrollment_id
          join class_groups g on g.id = e.class_group_id
          join courses c on c.id = g.course_id
         group by own.payment_id
      )
      select
        "payments"."id",
        pr.kind as procedure_kind,
        oc.course_names,
        case when "payments"."procedure_request_id" is not null then 1
             else 1 + (select count(*) from payment_lot_enrollments l where l.payment_id = "payments"."id") end as enrollment_count,
        "payments"."status",
        "payments"."method",
        "payments"."method_detail",
        "payments"."operation_number",
        "payments"."amount_cents",
        coalesce(pr.amount_cents, base_price.amount_cents + ${lotExpectedExtraCents}) as expected_amount_cents,
        case when reread.receipt_upload_id is not null then reread.amount_cents else first_read.amount_cents end as read_amount_cents,
        case when reread.receipt_upload_id is not null then reread.validation_verdict else latest_upload.validation_verdict end as verdict,
        "payments"."rejection_reason",
        coalesce(latest_upload.processed_object_key is not null, false) as has_receipt,
        "payments"."created_at",
        "payments"."decided_at"
      from own_courses oc
      join payments on "payments"."id" = oc.payment_id
      left join procedure_requests pr on pr.id = "payments"."procedure_request_id"
      left join enrollments base_enrollment on base_enrollment.id = "payments"."enrollment_id"
      left join plan_prices base_price on base_price.id = base_enrollment.plan_price_id
      left join lateral (
        select u.id, u.validation_verdict, u.processed_object_key
          from receipt_uploads u
         where u.payment_id = "payments"."id"
         order by u.created_at desc, u.id desc
         limit 1
      ) latest_upload on true
      left join payment_receipts first_read
        on first_read.receipt_upload_id = latest_upload.id and first_read.tier = ${RECEIPT_EXTRACTION_TIER_PRIMARY}
      left join lateral (
        select r.receipt_upload_id, r.amount_cents, r.validation_verdict
          from receipt_rereads r
         where r.receipt_upload_id = latest_upload.id and r.read_at is not null
         order by r.read_at desc, r.id desc
         limit 1
      ) reread on true
      order by "payments"."created_at" desc, "payments"."id" desc
    `);

    return result.rows.map((row) => ({
      id: row.id,
      procedureKind: row.procedure_kind === null ? null : ProcedureKindSchema.parse(row.procedure_kind),
      courseNames: row.course_names,
      enrollmentCount: Number(row.enrollment_count),
      // Held to these unions by CHECK constraints (payments_status_check,
      // payments_method_check, payments_rejection_reason_check).
      status: row.status as StudentPaymentStatus,
      method: PaymentMethodSchema.parse(row.method),
      methodDetail: row.method_detail,
      operationNumber: row.operation_number,
      amountCents: row.amount_cents,
      expectedAmountCents: Number(row.expected_amount_cents),
      readAmountCents: row.read_amount_cents,
      verdict: row.verdict !== null && isReceiptVerdict(row.verdict) ? row.verdict : null,
      rejectionReason:
        row.rejection_reason !== null && REJECTION_REASONS.has(row.rejection_reason)
          ? (row.rejection_reason as StudentPaymentRejectionReason)
          : null,
      hasReceipt: row.has_receipt,
      submittedAt: new Date(row.created_at),
      decidedAt: row.decided_at === null ? null : new Date(row.decided_at),
    }));
  }
}
