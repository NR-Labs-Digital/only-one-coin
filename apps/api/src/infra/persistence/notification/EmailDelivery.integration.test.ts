import * as schema from "@ooc/db";
import { academicPeriods, auditLog, classGroups, courses, guardians, outbox, planPrices, plans, students } from "@ooc/db";
import { CreateManualEnrollmentUseCase, ResendFailedEmailUseCase } from "@ooc/domain";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq, like } from "drizzle-orm";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/infra/db/client.js";
import { DrizzleAuditLogRepository } from "@/infra/identity/DrizzleAuditLogRepository.js";
import { DrizzleEnrollmentEmailContextLookup } from "@/infra/persistence/enrollment/DrizzleEnrollmentEmailContextLookup.js";
import { DrizzleEnrollmentRepository } from "@/infra/persistence/enrollment/DrizzleEnrollmentRepository.js";
import { DrizzlePlanPriceLookup } from "@/infra/persistence/enrollment/DrizzlePlanPriceLookup.js";
import { DrizzleEmailDeliveryRepository } from "./DrizzleEmailDeliveryRepository.js";
import { EmailDeliveryQuery } from "./EmailDeliveryQuery.js";

/**
 * The undelivered e-mails screen (OOC-90) against a real, migrated Postgres:
 * a failed row is read back to the student its dedupe key leads to (the
 * outbox has no `student_id`), a resend is a new row plus its audit entry in
 * one transaction, and a resent row leaves the list.
 *
 * Runs with `pnpm test:api:db`. Every test runs inside one transaction that
 * is always rolled back — `students` cannot be deleted (CLAUDE.md §6).
 */

const { Pool } = pg;

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is required: this suite exercises the outbox against a real, migrated Postgres.");
}

const PERIOD = "018f2b5c-4000-7000-8000-0000000009a1";
const COURSE = "018f2b5c-4000-7000-8000-0000000009a2";
const PLAN = "018f2b5c-4000-7000-8000-0000000009a3";
const PLAN_PRICE = "018f2b5c-4000-7000-8000-0000000009a4";
const CLASS_GROUP = "018f2b5c-4000-7000-8000-0000000009a5";
const STUDENT = "018f2b5c-4000-7000-8000-0000000009a6";

const OLD_ADDRESS = "rosa.deliveries.old@gmail.com";
const NEW_ADDRESS = "rosa.deliveries.new@gmail.com";
const GUARDIAN_ADDRESS = "madre.deliveries@example.com";

let pool: pg.Pool;
let db: Db;

beforeAll(() => {
  pool = new Pool({ connectionString: DATABASE_URL, max: 1 });
  db = drizzle(pool, { schema, casing: "snake_case" });
});

afterAll(async () => {
  await pool.end();
});

class RollBack extends Error {}

async function inRolledBackTransaction(fn: (tx: Db) => Promise<void>): Promise<void> {
  await db
    .transaction(async (tx) => {
      await fn(tx as unknown as Db);
      throw new RollBack();
    })
    .catch((error: unknown) => {
      if (!(error instanceof RollBack)) throw error;
    });
}

/** An enrollment and its payment, with the e-mail it wrote marked failed,
 * and a failed payment e-mail to the guardian beside it. */
async function seed(tx: Db): Promise<{ enrollmentRow: string; paymentRow: string; paymentId: string }> {
  await tx.insert(academicPeriods).values({
    id: PERIOD,
    name: "Ciclo de prueba (deliveries)",
    startsOn: new Date("2026-10-01T00:00:00.000Z"),
    endsOn: new Date("2027-01-31T00:00:00.000Z"),
  });
  await tx.insert(courses).values({ id: COURSE, name: "Inglés Básico (deliveries)", language: "en", minAge: 12 });
  await tx.insert(plans).values({ id: PLAN, courseId: COURSE, name: "Paquete completo" });
  await tx.insert(planPrices).values({ id: PLAN_PRICE, planId: PLAN, amountCents: 25000, validFrom: new Date("2026-01-01T00:00:00.000Z") });
  await tx.insert(classGroups).values({
    id: CLASS_GROUP,
    courseId: COURSE,
    academicPeriodId: PERIOD,
    schedule: "Lun/Mié 19:00",
    startsOn: new Date("2026-10-05T05:00:00.000Z"),
    endsOn: new Date("2026-12-18T05:00:00.000Z"),
    capacity: 5,
    seatsTaken: 0,
  });
  await tx.insert(students).values({
    id: STUDENT,
    firstName: "Rosa",
    lastName: "Quispe",
    nationalIdType: "DNI",
    nationalId: "70000991",
    email: OLD_ADDRESS,
    phone: "+51987654321",
    birthDate: new Date("2000-01-01T00:00:00.000Z"),
    country: "PE",
    city: "Lima",
  });
  await tx.insert(guardians).values({
    studentId: STUDENT,
    firstName: "Carmen",
    lastName: "Quispe",
    relationship: "mother",
    nationalIdType: "DNI",
    nationalId: "40000991",
    email: GUARDIAN_ADDRESS,
    phone: "+51987654322",
  });

  const { enrollment, payment } = await new CreateManualEnrollmentUseCase(
    new DrizzleEnrollmentRepository(tx),
    new DrizzlePlanPriceLookup(tx),
    new DrizzleEnrollmentEmailContextLookup(tx),
    new DrizzleAuditLogRepository(tx),
  ).run({
    actorId: "staff-integration",
    studentId: STUDENT,
    planId: PLAN,
    classGroupId: CLASS_GROUP,
    method: "yape",
    methodDetail: null,
    operationNumber: "00099111",
    receiptAttached: true,
  });

  const [enrollmentRow] = await tx
    .update(outbox)
    .set({ status: "failed", attempts: 5, lastError: "brevo_http_503" })
    .where(eq(outbox.dedupeKey, `enrollment_received:${enrollment.id}:student`))
    .returning({ id: outbox.id });

  const [paymentRow] = await tx
    .insert(outbox)
    .values({
      templateKey: "payment_rejected",
      recipient: GUARDIAN_ADDRESS,
      locale: "es-PE",
      vars: { recipientName: "Carmen", studentName: "Rosa Quispe", courseName: "Inglés Básico (deliveries)" },
      dedupeKey: `payment_rejected:${payment.id}:guardian`,
      status: "failed",
      attempts: 1,
      lastError: "brevo_http_400_invalid_parameter",
    })
    .returning({ id: outbox.id });

  return { enrollmentRow: enrollmentRow!.id, paymentRow: paymentRow!.id, paymentId: payment.id };
}

function ours<T extends { studentId: string | null }>(items: T[]): T[] {
  return items.filter((item) => item.studentId === STUDENT);
}

describe("the undelivered e-mails list", () => {
  it("reads each failed row back to its student, through the enrollment and through the payment", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { enrollmentRow, paymentRow } = await seed(tx);

      const { items } = await new EmailDeliveryQuery(tx).list({});
      const rows = ours(items);

      expect(rows.map((row) => row.id).sort()).toEqual([enrollmentRow, paymentRow].sort());
      expect(rows.find((row) => row.id === enrollmentRow)).toMatchObject({
        template: "enrollment_received",
        studentName: "Rosa Quispe",
        recipientKind: "student",
        address: OLD_ADDRESS,
        reason: "provider_unavailable",
        attempts: 5,
        resendable: true,
      });
      expect(rows.find((row) => row.id === paymentRow)).toMatchObject({
        template: "payment_rejected",
        recipientKind: "guardian",
        address: GUARDIAN_ADDRESS,
        reason: "provider_refused",
      });
    });
  });

  it("filters by template, and leaves out what did not fail", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { paymentRow } = await seed(tx);
      await tx.insert(outbox).values({
        templateKey: "payment_approved",
        recipient: OLD_ADDRESS,
        locale: "es-PE",
        vars: {},
        dedupeKey: `payment_approved:${STUDENT}-sent:student`,
        status: "sent",
      });

      const { items } = await new EmailDeliveryQuery(tx).list({ template: "payment_rejected" });

      expect(ours(items).map((row) => row.id)).toEqual([paymentRow]);
    });
  });
});

describe("resending a failed e-mail", () => {
  it("writes a new row to the address on the file today, audits it, and drops the failed row off the list", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { enrollmentRow } = await seed(tx);
      // The address was fixed on the file after the e-mail failed.
      await tx.update(students).set({ email: NEW_ADDRESS }).where(eq(students.id, STUDENT));

      const { outboxId } = await new ResendFailedEmailUseCase(new DrizzleEmailDeliveryRepository(tx)).run({
        actorId: "staff-integration",
        outboxId: enrollmentRow,
      });

      const [failed] = await tx.select().from(outbox).where(eq(outbox.id, enrollmentRow));
      const [resent] = await tx.select().from(outbox).where(eq(outbox.id, outboxId));
      expect(failed!.status).toBe("failed");
      expect(resent).toMatchObject({
        templateKey: "enrollment_received",
        recipient: NEW_ADDRESS,
        locale: failed!.locale,
        vars: failed!.vars,
        dedupeKey: `${failed!.dedupeKey}:resend`,
        status: "pending",
        attempts: 0,
      });

      const entries = await tx.select().from(auditLog).where(eq(auditLog.targetId, enrollmentRow));
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        actorId: "staff-integration",
        action: "email.resent",
        metadata: { template: "enrollment_received", resentAs: outboxId, studentId: STUDENT },
      });

      const { items } = await new EmailDeliveryQuery(tx).list({});
      expect(ours(items).map((row) => row.id)).not.toContain(enrollmentRow);
    });
  });

  it("sends the guardian's copy to the guardian's address", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { paymentRow } = await seed(tx);

      const { outboxId } = await new ResendFailedEmailUseCase(new DrizzleEmailDeliveryRepository(tx)).run({
        actorId: "staff-integration",
        outboxId: paymentRow,
      });

      const [resent] = await tx.select().from(outbox).where(eq(outbox.id, outboxId));
      expect(resent!.recipient).toBe(GUARDIAN_ADDRESS);
    });
  });

  it("refuses a second resend of the same row and writes nothing more", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { enrollmentRow } = await seed(tx);
      const resend = new ResendFailedEmailUseCase(new DrizzleEmailDeliveryRepository(tx));

      await resend.run({ actorId: "staff-integration", outboxId: enrollmentRow });
      await expect(resend.run({ actorId: "staff-integration", outboxId: enrollmentRow })).rejects.toMatchObject({
        reason: "email_delivery.already_resent",
      });

      const copies = await tx.select().from(outbox).where(like(outbox.dedupeKey, "enrollment_received:%:student:resend%"));
      expect(copies.filter((row) => row.recipient === OLD_ADDRESS)).toHaveLength(1);
      expect(await tx.select().from(auditLog).where(eq(auditLog.targetId, enrollmentRow))).toHaveLength(1);
    });
  });
});
