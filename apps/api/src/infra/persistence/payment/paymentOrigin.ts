import { payments, procedureRequests } from "@ooc/db";
import { sql } from "drizzle-orm";

/**
 * The enrollment a payment leads to, whichever origin it has (OOC-83): its own
 * column, or the one its procedure request refers to. Every read about the
 * money goes through here — Payments, the receipt pipeline, the portal's
 * ownership check — and needs the request joined first:
 *
 *   .leftJoin(procedureRequests, eq(procedureRequests.id, payments.procedureRequestId))
 *   .innerJoin(enrollments, eq(enrollments.id, paymentEnrollmentId))
 *
 * A read about the seat (the enrollment ledger, the roster, the student's
 * history) joins `payments.enrollment_id` directly on purpose: a constancia's
 * payment is not the enrollment's payment, and "the newest payment speaks for
 * the seat" must not start listening to it.
 */
export const paymentEnrollmentId = sql`coalesce(${payments.enrollmentId}, ${procedureRequests.enrollmentId})`;
