import {
  MonthlyModulesNotForSaleError,
  MonthlyNotPayableError,
  ReceiptNotReadyError,
  monthlyAmountCents,
  monthlyReceiptObjectKey,
  purchasableModules,
  selectPrefix,
  type CoverageStatus,
  type IMonthlyPaymentRepository,
  type MonthlyPaymentSubmitted,
  type SubmitMonthlyPaymentParams,
} from "@ooc/domain";
import {
  auditLog,
  classGroupModules,
  courses,
  enrollments,
  paymentModules,
  payments,
  planPrices,
  plans,
  receiptUploads,
  students,
} from "@ooc/db";
import { and, asc, desc, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import type { Db } from "@/infra/db/client.js";
import { assertOperationNumberUnused } from "@/infra/persistence/enrollment/operationNumberGuard.js";
import { reachesStudent } from "@/infra/persistence/portal/reachableStudents.js";
import { enrollmentModuleId } from "@/infra/persistence/catalog/classGroupModuleSql.js";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

const LIVE: CoverageStatus[] = ["pending", "under_review", "approved"];

/**
 * Monthly modules bought from the portal (OOC-86). Ownership is the account's
 * reach (`reachesStudent`, OOC-147); what is for sale is worked out again with
 * the enrollment locked, so two receipts sent at once never buy the same
 * module twice.
 */
export class DrizzleMonthlyPaymentRepository implements IMonthlyPaymentRepository {
  constructor(private readonly db: Db) {}

  async findOwnEnrollment(params: { userId: string; enrollmentId: string }) {
    const [row] = await this.db
      .select({ enrollmentId: enrollments.id, studentId: enrollments.studentId })
      .from(enrollments)
      .innerJoin(students, eq(students.id, enrollments.studentId))
      .innerJoin(planPrices, eq(planPrices.id, enrollments.planPriceId))
      .innerJoin(plans, eq(plans.id, planPrices.planId))
      .where(
        and(
          eq(enrollments.id, params.enrollmentId),
          reachesStudent(params.userId),
          eq(plans.billing, "monthly"),
          eq(enrollments.seatStatus, "confirmed"),
          isNull(enrollments.deletedAt),
          isNull(students.deletedAt),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async submitPayment(params: SubmitMonthlyPaymentParams): Promise<MonthlyPaymentSubmitted> {
    return this.db.transaction(async (tx) => {
      // Idempotency first: a retry of a submit that went through returns it.
      // The key belongs to one enrollment only.
      const [retried] = await tx
        .select({ id: payments.id, enrollmentId: payments.enrollmentId, amountCents: payments.amountCents })
        .from(payments)
        .where(eq(payments.idempotencyKey, params.idempotencyKey));
      if (retried) {
        if (retried.enrollmentId !== params.enrollmentId) throw new MonthlyModulesNotForSaleError();
        const bought = await tx
          .select({ module: paymentModules.module, attempt: paymentModules.attempt })
          .from(paymentModules)
          .where(eq(paymentModules.paymentId, retried.id))
          .orderBy(asc(paymentModules.module), asc(paymentModules.attempt));
        return { paymentId: retried.id, amountCents: retried.amountCents, modules: bought };
      }

      // FOR UPDATE on the enrollment: two receipts sent at once serialize here,
      // and the second one reads the first one's modules as bought.
      const [enrollment] = await tx
        .select({ id: enrollments.id, planPriceId: enrollments.planPriceId, moduleAttempt: enrollments.moduleAttempt })
        .from(enrollments)
        .where(eq(enrollments.id, params.enrollmentId))
        .for("update");
      if (!enrollment) throw new MonthlyNotPayableError();

      const current = await currentRunOf(tx, params.enrollmentId);
      if (!current || current.module === null) throw new MonthlyNotPayableError();

      const covered = await coveredModulesOf(tx, params.enrollmentId);
      const selection = selectPrefix(
        purchasableModules({
          current: { module: current.module, attempt: enrollment.moduleAttempt },
          courseModules: current.courseModules,
          covered,
        }),
        params.moduleCount,
      );
      if (!selection) throw new MonthlyModulesNotForSaleError();

      // The price in force today of the enrollment's plan — never the one the
      // enrollment froze: a module bought later costs what a module costs now.
      const [price] = await tx
        .select({ amountCents: planPrices.amountCents })
        .from(planPrices)
        .where(
          and(
            eq(planPrices.planId, sql`(select plan_id from plan_prices where id = ${enrollment.planPriceId})`),
            lte(planPrices.validFrom, sql`now()`),
          ),
        )
        .orderBy(desc(planPrices.validFrom), desc(planPrices.id))
        .limit(1);
      if (!price) throw new MonthlyNotPayableError();
      const amountCents = monthlyAmountCents(selection.length, price.amountCents);

      const [receipt] = await tx
        .select({ id: receiptUploads.id, objectKey: receiptUploads.objectKey })
        .from(receiptUploads)
        .where(
          and(
            eq(receiptUploads.id, params.receiptUploadId),
            eq(receiptUploads.uploadedBy, params.userId),
            inArray(receiptUploads.status, ["uploaded", "processed"]),
            isNull(receiptUploads.paymentId),
          ),
        )
        .for("update");
      if (!receipt || receipt.objectKey !== monthlyReceiptObjectKey(params.enrollmentId, receipt.id)) {
        throw new ReceiptNotReadyError();
      }

      await assertOperationNumberUnused(tx, { method: params.method, operationNumber: params.operationNumber });

      const [payment] = await tx
        .insert(payments)
        .values({
          enrollmentId: params.enrollmentId,
          idempotencyKey: params.idempotencyKey,
          method: params.method,
          amountCents,
          operationNumber: params.operationNumber,
        })
        .returning({ id: payments.id });
      if (!payment) throw new Error("Insert into payments returned no row");

      await tx.insert(paymentModules).values(
        selection.map((item) => ({
          paymentId: payment.id,
          enrollmentId: params.enrollmentId,
          module: item.module,
          attempt: item.attempt,
        })),
      );

      await tx.update(receiptUploads).set({ paymentId: payment.id, updatedAt: sql`now()` }).where(eq(receiptUploads.id, receipt.id));

      await tx.insert(auditLog).values({
        actorId: params.userId,
        action: "enrollment.monthly_payment_submitted",
        targetId: payment.id,
        metadata: {
          enrollmentId: params.enrollmentId,
          receiptUploadId: receipt.id,
          modules: selection.map((item) => item.module),
        },
      });

      return { paymentId: payment.id, amountCents, modules: selection };
    });
  }
}

/** The run the enrollment is in now, its module number and how many modules the course has. */
export async function currentRunOf(
  tx: Pick<Tx, "select">,
  enrollmentId: string,
): Promise<{ module: number | null; courseModules: number } | null> {
  const [row] = await tx
    .select({ module: classGroupModules.module, courseModules: courses.modules })
    .from(enrollments)
    .innerJoin(classGroupModules, eq(classGroupModules.id, enrollmentModuleId()))
    .innerJoin(planPrices, eq(planPrices.id, enrollments.planPriceId))
    .innerJoin(plans, eq(plans.id, planPrices.planId))
    .innerJoin(courses, eq(courses.id, plans.courseId))
    .where(eq(enrollments.id, enrollmentId))
    .limit(1);
  return row ?? null;
}

/** Every module this enrollment bought with a payment still alive. */
export async function coveredModulesOf(tx: Pick<Tx, "select">, enrollmentId: string) {
  const rows = await tx
    .select({ module: paymentModules.module, attempt: paymentModules.attempt, status: payments.status })
    .from(paymentModules)
    .innerJoin(payments, eq(payments.id, paymentModules.paymentId))
    .where(and(eq(paymentModules.enrollmentId, enrollmentId), inArray(payments.status, LIVE)));
  return rows.map((row) => ({ ...row, status: row.status as CoverageStatus }));
}
