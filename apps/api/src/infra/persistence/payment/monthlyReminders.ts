import { DEFAULT_LOCALE, monthlyAccessLock, monthlyModuleDueEmails, type EmailNotification } from "@ooc/domain";
import { classGroupModules, enrollments, planPrices, plans } from "@ooc/db";
import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import type { Db } from "@/infra/db/client.js";
import { enrollmentModuleId } from "@/infra/persistence/catalog/classGroupModuleSql.js";
import { DrizzleEnrollmentEmailContextLookup } from "@/infra/persistence/enrollment/DrizzleEnrollmentEmailContextLookup.js";
import { insertOutboxEmails } from "@/infra/persistence/notification/DrizzleOutboxRepository.js";
import { coveredModulesOf } from "./DrizzleMonthlyPaymentRepository.js";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * The reminder of a monthly module nobody bought (OOC-86, decision of
 * 20/11/2026): written in the transaction that took the seats into their new
 * module or attempt — progression — so it exists exactly when the move does.
 * Only a confirmed monthly seat in a numbered run whose module and attempt has
 * no live purchase hears about it; one bought ahead, even still in review,
 * does not. The e-mail is the domain's (`monthlyModuleDueEmails`), and the
 * dedupe key makes entering the same module and attempt twice a no-op.
 */
export async function queueMonthlyDueReminders(tx: Tx, enrollmentIds: string[]): Promise<void> {
  if (enrollmentIds.length === 0) return;

  const seats = await tx
    .select({
      enrollmentId: enrollments.id,
      studentId: enrollments.studentId,
      classGroupId: enrollments.classGroupId,
      module: classGroupModules.module,
      attempt: enrollments.moduleAttempt,
    })
    .from(enrollments)
    .innerJoin(classGroupModules, eq(classGroupModules.id, enrollmentModuleId()))
    .innerJoin(planPrices, eq(planPrices.id, enrollments.planPriceId))
    .innerJoin(plans, eq(plans.id, planPrices.planId))
    .where(
      and(
        inArray(enrollments.id, enrollmentIds),
        eq(plans.billing, "monthly"),
        eq(enrollments.seatStatus, "confirmed"),
        isNull(enrollments.deletedAt),
        isNotNull(classGroupModules.module),
      ),
    );

  const contexts = new DrizzleEnrollmentEmailContextLookup(tx as unknown as Db);
  const emails: EmailNotification[] = [];
  for (const seat of seats) {
    const current = { module: seat.module!, attempt: seat.attempt };
    if (monthlyAccessLock(current, await coveredModulesOf(tx, seat.enrollmentId)) !== "monthly_payment_due") continue;
    const context = await contexts.find({ studentId: seat.studentId, classGroupId: seat.classGroupId });
    if (!context) continue;
    emails.push(...monthlyModuleDueEmails({ ...context, enrollmentId: seat.enrollmentId, ...current }, DEFAULT_LOCALE));
  }
  await insertOutboxEmails(tx, emails);
}
