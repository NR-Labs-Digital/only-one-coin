import type { EnrollmentEmailContext, IPaymentEmailContextLookup, PaymentCoverageEmailFacts } from "@ooc/domain";

/**
 * A payment's e-mail facts built from single-enrollment contexts (OOC-158):
 * one context is an ordinary payment, several a lot. Null answers "no
 * enrollment on file", like the real lookup.
 */
export class FakePaymentEmailLookup implements IPaymentEmailContextLookup {
  readonly asked: string[] = [];

  constructor(private readonly contexts: EnrollmentEmailContext[] | null) {}

  find(paymentId: string): Promise<PaymentCoverageEmailFacts | null> {
    this.asked.push(paymentId);
    if (!this.contexts || this.contexts.length === 0) return Promise.resolve(null);
    return Promise.resolve({
      paymentId,
      items: this.contexts.map((context, index) => ({
        enrollmentId: `enrollment-${index + 1}`,
        studentId: `student-${index + 1}`,
        ...context,
      })),
    });
  }
}
