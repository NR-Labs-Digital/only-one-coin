import {
  ProcedureNotPayableError,
  ReceiptNotReadyError,
  type IProcedureRepository,
  type ProcedureKind,
  type ProcedurePrice,
  type ProcedureRequestRef,
  type ProcedureRequestStatus,
  type SubmitProcedurePaymentParams,
} from "@ooc/domain";
import { auditLog, enrollments, payments, procedurePrices, procedureRequests, receiptUploads, students } from "@ooc/db";
import { and, desc, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import type { Db } from "@/infra/db/client.js";
import { assertOperationNumberUnused } from "@/infra/persistence/enrollment/operationNumberGuard.js";
import { reachesStudent } from "@/infra/persistence/portal/reachableStudents.js";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

const LIVE_STATUSES: ProcedureRequestStatus[] = ["requested", "paid"];

/**
 * Paid procedures (OOC-83). Ownership is always a join to `students.user_id`
 * from the session's account: `students.user_id` is not unique while duplicates
 * are not consolidated, so a person's enrollment may hang off an older file of
 * the same account (StudentPortalQuery).
 */
export class DrizzleProcedureRepository implements IProcedureRepository {
  constructor(private readonly db: Db) {}

  async findEligibleEnrollment(params: { userId: string; enrollmentId: string }): Promise<{ studentId: string } | null> {
    const [row] = await this.db
      .select({ studentId: enrollments.studentId })
      .from(enrollments)
      .innerJoin(students, eq(students.id, enrollments.studentId))
      .where(
        and(
          eq(enrollments.id, params.enrollmentId),
          reachesStudent(params.userId),
          eq(enrollments.seatStatus, "confirmed"),
          isNull(enrollments.deletedAt),
          isNull(students.deletedAt),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async findOwnRequest(params: { userId: string; requestId: string }): Promise<ProcedureRequestRef | null> {
    const [row] = await this.db
      .select(requestColumns)
      .from(procedureRequests)
      .innerJoin(students, eq(students.id, procedureRequests.studentId))
      .leftJoin(payments, eq(payments.procedureRequestId, procedureRequests.id))
      .where(and(eq(procedureRequests.id, params.requestId), reachesStudent(params.userId)))
      .limit(1);
    return row ? toRef(row) : null;
  }

  async open(params: { kind: ProcedureKind; studentId: string; enrollmentId: string; actorId: string }): Promise<ProcedureRequestRef | null> {
    return this.db.transaction(async (tx) => {
      const live = await this.findLive(tx, params.enrollmentId, params.kind);
      if (live) return live;

      const [price] = await tx
        .select({ id: procedurePrices.id, amountCents: procedurePrices.amountCents })
        .from(procedurePrices)
        .where(and(eq(procedurePrices.kind, params.kind), lte(procedurePrices.validFrom, sql`now()`)))
        .orderBy(desc(procedurePrices.validFrom), desc(procedurePrices.id))
        .limit(1);
      if (!price) return null;

      const [created] = await tx
        .insert(procedureRequests)
        .values({
          kind: params.kind,
          studentId: params.studentId,
          enrollmentId: params.enrollmentId,
          procedurePriceId: price.id,
          amountCents: price.amountCents,
        })
        .onConflictDoNothing({
          target: [procedureRequests.enrollmentId, procedureRequests.kind],
          where: sql`${procedureRequests.status} in ('requested', 'paid')`,
        })
        .returning({ id: procedureRequests.id });

      // The other tap of a double tap got there first: its row is now visible.
      if (!created) return this.findLive(tx, params.enrollmentId, params.kind);

      await tx.insert(auditLog).values({
        actorId: params.actorId,
        action: "procedure_request.opened",
        targetId: created.id,
        metadata: { kind: params.kind, studentId: params.studentId, enrollmentId: params.enrollmentId },
      });

      return {
        id: created.id,
        kind: params.kind,
        status: "requested",
        studentId: params.studentId,
        enrollmentId: params.enrollmentId,
        amountCents: price.amountCents,
        paymentId: null,
      };
    });
  }

  async submitPayment(params: SubmitProcedurePaymentParams): Promise<{ paymentId: string }> {
    return this.db.transaction(async (tx) => {
      // Idempotency first (apps/api/CLAUDE.md, Pagamento): a retry of a submit
      // that went through returns it. The key belongs to one request only.
      const [retried] = await tx
        .select({ id: payments.id, procedureRequestId: payments.procedureRequestId })
        .from(payments)
        .where(eq(payments.idempotencyKey, params.idempotencyKey));
      if (retried) {
        if (retried.procedureRequestId !== params.requestId) throw new ProcedureNotPayableError();
        return { paymentId: retried.id };
      }

      // FOR UPDATE, so two different keys on the same request serialize here
      // and the second one finds the first one's payment.
      const [request] = await tx
        .select({ status: procedureRequests.status, amountCents: procedureRequests.amountCents })
        .from(procedureRequests)
        .where(eq(procedureRequests.id, params.requestId))
        .for("update");
      if (request?.status !== "requested") throw new ProcedureNotPayableError();

      const [existing] = await tx
        .select({ id: payments.id })
        .from(payments)
        .where(eq(payments.procedureRequestId, params.requestId));
      if (existing) throw new ProcedureNotPayableError();

      const [receipt] = await tx
        .select({ id: receiptUploads.id })
        .from(receiptUploads)
        .where(
          and(
            eq(receiptUploads.id, params.receiptUploadId),
            eq(receiptUploads.procedureRequestId, params.requestId),
            inArray(receiptUploads.status, ["uploaded", "processed"]),
            isNull(receiptUploads.paymentId),
          ),
        )
        .for("update");
      if (!receipt) throw new ReceiptNotReadyError();

      await assertOperationNumberUnused(tx, { method: params.method, operationNumber: params.operationNumber });

      const [payment] = await tx
        .insert(payments)
        .values({
          procedureRequestId: params.requestId,
          idempotencyKey: params.idempotencyKey,
          method: params.method,
          amountCents: request.amountCents,
          operationNumber: params.operationNumber,
        })
        .returning({ id: payments.id });
      if (!payment) throw new Error("Insert into payments returned no row");

      await tx.update(receiptUploads).set({ paymentId: payment.id, updatedAt: sql`now()` }).where(eq(receiptUploads.id, receipt.id));

      await tx.insert(auditLog).values({
        actorId: params.actorId,
        action: "procedure_request.payment_submitted",
        targetId: payment.id,
        metadata: { procedureRequestId: params.requestId, receiptUploadId: receipt.id },
      });

      return { paymentId: payment.id };
    });
  }

  async currentPrices(): Promise<ProcedurePrice[]> {
    const rows = await this.db
      .selectDistinctOn([procedurePrices.kind], {
        id: procedurePrices.id,
        kind: procedurePrices.kind,
        amountCents: procedurePrices.amountCents,
        validFrom: procedurePrices.validFrom,
      })
      .from(procedurePrices)
      .where(lte(procedurePrices.validFrom, sql`now()`))
      .orderBy(procedurePrices.kind, desc(procedurePrices.validFrom), desc(procedurePrices.id));
    return rows.map((row) => ({ ...row, kind: row.kind as ProcedureKind }));
  }

  async addPrice(params: Parameters<IProcedureRepository["addPrice"]>[0]): Promise<ProcedurePrice> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(procedurePrices)
        .values({ kind: params.kind, amountCents: params.amountCents, createdBy: params.actorId })
        .returning({
          id: procedurePrices.id,
          amountCents: procedurePrices.amountCents,
          validFrom: procedurePrices.validFrom,
        });
      if (!row) throw new Error("Insert into procedure_prices returned no row");

      await tx.insert(auditLog).values({
        actorId: params.audit.actorId,
        action: params.audit.action,
        targetId: row.id,
        metadata: params.audit.metadata ?? null,
        createdAt: params.audit.at,
      });

      return { ...row, kind: params.kind };
    });
  }

  private async findLive(tx: Tx, enrollmentId: string, kind: ProcedureKind): Promise<ProcedureRequestRef | null> {
    const [row] = await tx
      .select(requestColumns)
      .from(procedureRequests)
      .leftJoin(payments, eq(payments.procedureRequestId, procedureRequests.id))
      .where(
        and(
          eq(procedureRequests.enrollmentId, enrollmentId),
          eq(procedureRequests.kind, kind),
          inArray(procedureRequests.status, LIVE_STATUSES),
        ),
      )
      .limit(1);
    return row ? toRef(row) : null;
  }
}

const requestColumns = {
  id: procedureRequests.id,
  kind: procedureRequests.kind,
  status: procedureRequests.status,
  studentId: procedureRequests.studentId,
  enrollmentId: procedureRequests.enrollmentId,
  amountCents: procedureRequests.amountCents,
  paymentId: payments.id,
};

function toRef(row: {
  id: string;
  kind: string;
  status: string;
  studentId: string;
  enrollmentId: string;
  amountCents: number;
  paymentId: string | null;
}): ProcedureRequestRef {
  return { ...row, kind: row.kind as ProcedureKind, status: row.status as ProcedureRequestStatus };
}

