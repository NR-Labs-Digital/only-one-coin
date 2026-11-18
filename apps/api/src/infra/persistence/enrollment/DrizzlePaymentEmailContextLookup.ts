import type { IPaymentEmailContextLookup, PaymentCoverageEmailFacts, PaymentItemEmailFacts } from "@ooc/domain";
import { enrollments, paymentLotEnrollments, payments } from "@ooc/db";
import { asc, eq } from "drizzle-orm";
import type { Db } from "@/infra/db/client.js";
import type { IEnrollmentEmailContextLookup } from "@ooc/domain";

/**
 * Who a payment's e-mails go to, for every enrollment it pays for (OOC-158):
 * its own enrollment first, then its lot's, each read the way the
 * single-enrollment lookup reads one. A procedure's payment has no enrollment
 * of its own and is not answered here.
 */
export class DrizzlePaymentEmailContextLookup implements IPaymentEmailContextLookup {
  constructor(
    private readonly db: Db,
    private readonly enrollmentContext: IEnrollmentEmailContextLookup,
  ) {}

  async find(paymentId: string): Promise<PaymentCoverageEmailFacts | null> {
    const [own] = await this.db
      .select({ enrollmentId: enrollments.id, studentId: enrollments.studentId, classGroupId: enrollments.classGroupId })
      .from(payments)
      .innerJoin(enrollments, eq(enrollments.id, payments.enrollmentId))
      .where(eq(payments.id, paymentId));
    if (!own) return null;

    const lot = await this.db
      .select({ enrollmentId: enrollments.id, studentId: enrollments.studentId, classGroupId: enrollments.classGroupId })
      .from(paymentLotEnrollments)
      .innerJoin(enrollments, eq(enrollments.id, paymentLotEnrollments.enrollmentId))
      .where(eq(paymentLotEnrollments.paymentId, paymentId))
      .orderBy(asc(paymentLotEnrollments.id));

    const items: PaymentItemEmailFacts[] = [];
    for (const seat of [own, ...lot]) {
      const context = await this.enrollmentContext.find({ studentId: seat.studentId, classGroupId: seat.classGroupId });
      // An item nobody can write to is left out, not the whole payment: the
      // others still hear about their money.
      if (context) items.push({ enrollmentId: seat.enrollmentId, studentId: seat.studentId, ...context });
    }
    return items.length > 0 ? { paymentId, items } : null;
  }
}
