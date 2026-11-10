import * as schema from "@ooc/db";
import { academicPeriods, classGroups, courses, outbox, planPrices, plans, students } from "@ooc/db";
import { ClassGroupFullError, CreateManualEnrollmentUseCase, type EmailNotification } from "@ooc/domain";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/infra/db/client.js";
import { DrizzleAuditLogRepository } from "@/infra/identity/DrizzleAuditLogRepository.js";
import { DrizzleEnrollmentEmailContextLookup } from "@/infra/persistence/enrollment/DrizzleEnrollmentEmailContextLookup.js";
import { DrizzleEnrollmentRepository } from "@/infra/persistence/enrollment/DrizzleEnrollmentRepository.js";
import { DrizzlePlanPriceLookup } from "@/infra/persistence/enrollment/DrizzlePlanPriceLookup.js";
import { DrizzleOutboxRepository, insertOutboxEmails } from "./DrizzleOutboxRepository.js";
import { seedManualReceipt } from "@/tests/fixtures/manualReceipt.js";

/**
 * The outbox against a real, migrated Postgres — the "pronto quando" of the
 * outbox work in code: a domain event (an enrollment) writes its e-mail row in
 * the same transaction, an enrollment that fails leaves no e-mail behind, the
 * dedupe key holds in the database, and the delivery transitions never move a
 * row out of an end state.
 *
 * Runs with `pnpm test:api:db` (CI: the `migrations` job). Every test runs
 * inside one transaction that is always rolled back — the repositories' own
 * transactions nest as savepoints — because `students` cannot be deleted
 * (CLAUDE.md §6) and this writes to a database somebody else owns.
 */

const { Pool } = pg;

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is required: this suite exercises the outbox against a real, migrated Postgres.");
}

const PERIOD = "018f2b5c-4000-7000-8000-000000000001";
const COURSE = "018f2b5c-4000-7000-8000-000000000002";
const PLAN = "018f2b5c-4000-7000-8000-000000000003";
const PLAN_PRICE = "018f2b5c-4000-7000-8000-000000000004";
const CLASS_GROUP = "018f2b5c-4000-7000-8000-000000000005";
const FULL_CLASS_GROUP = "018f2b5c-4000-7000-8000-000000000006";
const STUDENT = "018f2b5c-4000-7000-8000-000000000007";

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

/** Runs `fn` against a transaction that never commits. */
async function inRolledBackTransaction(fn: (tx: Db) => Promise<void>): Promise<void> {
  await db
    .transaction(async (tx) => {
      // A transaction exposes the same query API as Db, and nested
      // `transaction()` calls on it become savepoints.
      await fn(tx as unknown as Db);
      throw new RollBack();
    })
    .catch((error: unknown) => {
      if (!(error instanceof RollBack)) throw error;
    });
}

async function seed(tx: Db): Promise<void> {
  await tx.insert(academicPeriods).values({
    id: PERIOD,
    name: "Ciclo de prueba (integration)",
    startsOn: new Date("2026-10-01T00:00:00.000Z"),
    endsOn: new Date("2027-01-31T00:00:00.000Z"),
  });
  await tx.insert(courses).values({ id: COURSE, name: "Inglés Básico (integration)", language: "en", minAge: 12 });
  await tx.insert(plans).values({ id: PLAN, courseId: COURSE, name: "Paquete completo" });
  await tx.insert(planPrices).values({
    id: PLAN_PRICE,
    planId: PLAN,
    amountCents: 25000,
    validFrom: new Date("2026-01-01T00:00:00.000Z"),
  });
  for (const [id, seatsTaken] of [
    [CLASS_GROUP, 0],
    [FULL_CLASS_GROUP, 1],
  ] as const) {
    await tx.insert(classGroups).values({
      id,
      courseId: COURSE,
      academicPeriodId: PERIOD,
      schedule: "Lun/Mié 19:00",
      startsOn: new Date("2026-10-05T05:00:00.000Z"),
      endsOn: new Date("2026-12-18T05:00:00.000Z"),
      capacity: 1,
      seatsTaken,
    });
  }
  await tx.insert(students).values({
    id: STUDENT,
    firstName: "Rosa",
    lastName: "Quispe",
    nationalIdType: "DNI",
    nationalId: "70000077",
    email: "rosa.outbox.integration@gmail.com",
    phone: "+51987654321",
    birthDate: new Date("2000-01-01T00:00:00.000Z"),
    country: "PE",
    city: "Lima",
  });
}

function manualEnrollment(tx: Db): CreateManualEnrollmentUseCase {
  return new CreateManualEnrollmentUseCase(
    new DrizzleEnrollmentRepository(tx),
    new DrizzlePlanPriceLookup(tx),
    new DrizzleEnrollmentEmailContextLookup(tx),
    new DrizzleAuditLogRepository(tx),
  );
}

const MANUAL_INPUT = {
  studentId: STUDENT,
  planId: PLAN,
  method: "yape" as const,
  methodDetail: null,
  operationNumber: "00077777",
};

describe("an enrollment writes its e-mail to the outbox", () => {
  it("in the same transaction, pending, with everything the worker needs", async () => {
    await inRolledBackTransaction(async (tx) => {
      await seed(tx);

      const { actorId, receiptUploadId } = await seedManualReceipt(tx, "staff-integration");
      const { enrollment } = await manualEnrollment(tx).run({
        ...MANUAL_INPUT,
        actorId,
        receiptUploadId,
        classGroupId: CLASS_GROUP,
      });

      const rows = await tx.select().from(outbox).where(eq(outbox.dedupeKey, `enrollment_received:${enrollment.id}:student`));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        channel: "email",
        templateKey: "enrollment_received",
        recipient: "rosa.outbox.integration@gmail.com",
        locale: "es-PE",
        status: "pending",
        attempts: 0,
        vars: {
          recipientName: "Rosa",
          studentName: "Rosa Quispe",
          courseName: "Inglés Básico (integration)",
          startsOn: "2026-10-05T05:00:00.000Z",
          amountCents: 25000,
        },
      });
    });
  });

  it("and an enrollment that fails leaves no e-mail behind", async () => {
    await inRolledBackTransaction(async (tx) => {
      await seed(tx);

      const { actorId, receiptUploadId } = await seedManualReceipt(tx, "staff-integration");
      await expect(
        manualEnrollment(tx).run({ ...MANUAL_INPUT, actorId, receiptUploadId, classGroupId: FULL_CLASS_GROUP }),
      ).rejects.toBeInstanceOf(
        ClassGroupFullError,
      );

      const rows = await tx.select().from(outbox).where(eq(outbox.recipient, "rosa.outbox.integration@gmail.com"));
      expect(rows).toHaveLength(0);
    });
  });
});

const A_NOTIFICATION: EmailNotification = {
  templateKey: "payment_under_review",
  to: "someone.outbox.integration@gmail.com",
  locale: "en",
  vars: { recipientName: "Ana", studentName: "Ana Díaz", courseName: "Quechua" },
  dedupeKey: "payment_under_review:018f2b5c-4000-7000-8000-0000000000aa:student",
};

async function insertOne(tx: Db): Promise<string> {
  await insertOutboxEmails(tx, [A_NOTIFICATION]);
  const [row] = await tx.select({ id: outbox.id }).from(outbox).where(eq(outbox.dedupeKey, A_NOTIFICATION.dedupeKey));
  return row!.id;
}

describe("the outbox store", () => {
  it("writes the same message once, however many times it is emitted", async () => {
    await inRolledBackTransaction(async (tx) => {
      await insertOutboxEmails(tx, [A_NOTIFICATION]);
      await insertOutboxEmails(tx, [A_NOTIFICATION]);

      const rows = await tx.select().from(outbox).where(eq(outbox.dedupeKey, A_NOTIFICATION.dedupeKey));
      expect(rows).toHaveLength(1);
    });
  });

  it("offers a pending row, then never moves it once sent", async () => {
    await inRolledBackTransaction(async (tx) => {
      const store = new DrizzleOutboxRepository(tx);
      const id = await insertOne(tx);

      expect(await store.listPendingIds(10_000)).toContain(id);
      expect(await store.findById(id)).toMatchObject({
        templateKey: "payment_under_review",
        recipient: A_NOTIFICATION.to,
        locale: "en",
        vars: A_NOTIFICATION.vars,
        status: "pending",
      });

      await store.markSent(id, "<msg@brevo>");
      // A late duplicate job must not turn a sent row into a failed one.
      await store.recordFailedAttempt(id, "brevo_http_503", true);
      await store.markBlocked(id);

      const [row] = await tx.select().from(outbox).where(eq(outbox.id, id));
      expect(row).toMatchObject({ status: "sent", attempts: 1, providerMessageId: "<msg@brevo>", lastError: null });
      expect(row!.sentAt).toBeInstanceOf(Date);
      expect(await store.listPendingIds(10_000)).not.toContain(id);
    });
  });

  it("counts retries, and fails the row on the last one", async () => {
    await inRolledBackTransaction(async (tx) => {
      const store = new DrizzleOutboxRepository(tx);
      const id = await insertOne(tx);

      await store.recordFailedAttempt(id, "brevo_http_503", false);
      expect(await store.findById(id)).toMatchObject({ status: "pending", attempts: 1 });

      await store.recordFailedAttempt(id, "brevo_http_503", true);
      const [row] = await tx.select().from(outbox).where(eq(outbox.id, id));
      expect(row).toMatchObject({ status: "failed", attempts: 2, lastError: "brevo_http_503" });
    });
  });

  it("marks an allowlist refusal as blocked", async () => {
    await inRolledBackTransaction(async (tx) => {
      const store = new DrizzleOutboxRepository(tx);
      const id = await insertOne(tx);

      await store.markBlocked(id);
      expect(await store.findById(id)).toMatchObject({ status: "blocked", attempts: 0 });
    });
  });
});

describe("a one-time link never outlives its row's delivery", () => {
  const WITH_LINKS: EmailNotification = {
    templateKey: "portal_credentials",
    to: "link.outbox.integration@gmail.com",
    locale: "es-PE",
    vars: {
      recipientName: "Lucía",
      loginEmail: "link.outbox.integration@gmail.com",
      accessUrl: "https://student.example/access/raw-token",
    },
    dedupeKey: "portal_credentials:018f2b5c-4000-7000-8000-0000000000bb:student",
  };

  async function insertWithLinks(tx: Db): Promise<string> {
    // `resetUrl` too, so one row proves both keys are stripped.
    const both = { ...WITH_LINKS, vars: { ...WITH_LINKS.vars, resetUrl: "https://x/reset/raw" } } as EmailNotification;
    await insertOutboxEmails(tx, [both]);
    const [row] = await tx.select({ id: outbox.id }).from(outbox).where(eq(outbox.dedupeKey, WITH_LINKS.dedupeKey));
    return row!.id;
  }

  async function varsOf(tx: Db, id: string): Promise<unknown> {
    const [row] = await tx.select({ vars: outbox.vars }).from(outbox).where(eq(outbox.id, id));
    return row!.vars;
  }

  const WITHOUT_LINKS = { recipientName: "Lucía", loginEmail: "link.outbox.integration@gmail.com" };

  it("strips the link when the row is sent", async () => {
    await inRolledBackTransaction(async (tx) => {
      const id = await insertWithLinks(tx);
      await new DrizzleOutboxRepository(tx).markSent(id, "<msg@brevo>");
      expect(await varsOf(tx, id)).toEqual(WITHOUT_LINKS);
    });
  });

  it("strips the link when the row is blocked", async () => {
    await inRolledBackTransaction(async (tx) => {
      const id = await insertWithLinks(tx);
      await new DrizzleOutboxRepository(tx).markBlocked(id);
      expect(await varsOf(tx, id)).toEqual(WITHOUT_LINKS);
    });
  });

  it("keeps the link across a retryable failure, and strips it when the row finally fails", async () => {
    await inRolledBackTransaction(async (tx) => {
      const store = new DrizzleOutboxRepository(tx);
      const id = await insertWithLinks(tx);

      await store.recordFailedAttempt(id, "brevo_http_503", false);
      expect(await varsOf(tx, id)).toEqual({
        ...WITHOUT_LINKS,
        accessUrl: "https://student.example/access/raw-token",
        resetUrl: "https://x/reset/raw",
      });

      await store.recordFailedAttempt(id, "brevo_http_503", true);
      expect(await varsOf(tx, id)).toEqual(WITHOUT_LINKS);
    });
  });

  it("strips a verification code when the row is sent", async () => {
    await inRolledBackTransaction(async (tx) => {
      const notification: EmailNotification = {
        templateKey: "email_verification_code",
        to: "code.outbox.integration@gmail.com",
        locale: "es-PE",
        vars: { recipientName: "Lucía", code: "042137" },
        dedupeKey: "email_verification_code:018f2b5c-4000-7000-8000-0000000000cc:student",
      };
      await insertOutboxEmails(tx, [notification]);
      const [row] = await tx.select({ id: outbox.id }).from(outbox).where(eq(outbox.dedupeKey, notification.dedupeKey));
      await new DrizzleOutboxRepository(tx).markSent(row!.id, "<msg@brevo>");
      expect(await varsOf(tx, row!.id)).toEqual({ recipientName: "Lucía" });
    });
  });

  it("leaves vars without a link untouched", async () => {
    await inRolledBackTransaction(async (tx) => {
      const id = await insertOne(tx);
      await new DrizzleOutboxRepository(tx).markSent(id, "<msg@brevo>");
      expect(await varsOf(tx, id)).toEqual(A_NOTIFICATION.vars);
    });
  });
});
