import * as schema from "@ooc/db";
import { auditLog, outbox, outboxDeliveryEvents } from "@ooc/db";
import { Student, type EmailDeliveryEvent, type EmailDeliveryKind, type NationalIdType } from "@ooc/domain";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/infra/db/client.js";
import { DrizzleStudentRepository } from "@/infra/persistence/student/DrizzleStudentRepository.js";
import { BREVO_AUDIT_ACTOR, DrizzleEmailDeliveryRepository } from "./DrizzleEmailDeliveryRepository.js";

/**
 * What the Brevo webhook writes (OOC-91), against a real, migrated Postgres:
 * the event history, the outbox's last word on the message, and the file a
 * hard bounce flags. Runs with `pnpm test:api:db`; every test is one
 * transaction that is always rolled back (the repository's own transaction
 * nests as a savepoint) because `students` cannot be deleted (CLAUDE.md §6).
 */

const { Pool } = pg;

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is required: this suite exercises the delivery events against a real, migrated Postgres.");
}

const ADDRESS = "rosa.bounce.integration@gmail.com";
// How `POST /smtp/email` returns it — with the angle brackets the webhook leaves out.
const SENT_AS = "<202610310101.1@smtp-relay.mailin.fr>";
const MESSAGE_ID = "202610310101.1@smtp-relay.mailin.fr";

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

function event(kind: EmailDeliveryKind, at: string, reason: EmailDeliveryEvent["reason"] = null): EmailDeliveryEvent {
  const occurredAt = new Date(at);
  return { messageId: MESSAGE_ID, kind, reason, occurredAt, dedupeKey: `${MESSAGE_ID}:${kind}:${occurredAt.getTime()}` };
}

async function seed(tx: Db, recipient = ADDRESS): Promise<{ outboxId: string; studentId: string }> {
  const students = new DrizzleStudentRepository(tx);
  const student = await students.create(
    Student.create({
      firstName: "Rosa",
      lastName: "Bounce",
      nationalIdType: "DNI" as NationalIdType,
      nationalId: "70000091",
      email: ADDRESS,
      phone: "+51987654321",
      birthDate: new Date("1996-04-12T00:00:00.000Z"),
      country: "PE",
      region: "Lima",
      city: "Chorrillos",
    }),
  );
  const [row] = await tx
    .insert(outbox)
    .values({
      templateKey: "payment_approved",
      recipient,
      locale: "es-PE",
      dedupeKey: `payment_approved:bounce-integration:${Math.random()}`,
      status: "sent",
      providerMessageId: SENT_AS,
      sentAt: new Date(),
    })
    .returning({ id: outbox.id });
  return { outboxId: row!.id, studentId: student.id };
}

const statusOf = async (tx: Db, id: string) =>
  (await tx.select({ status: outbox.deliveryStatus }).from(outbox).where(eq(outbox.id, id)))[0]?.status;

describe("DrizzleEmailDeliveryRepository", () => {
  it("records a hard bounce: the event, the message's status and the flagged file", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { outboxId, studentId } = await seed(tx);
      const recorder = new DrizzleEmailDeliveryRepository(tx);

      const outcome = await recorder.record(event("hard_bounce", "2026-10-31T15:00:00.000Z", "address_unknown"));

      expect(outcome).toEqual({ kind: "recorded", studentsMarked: 1 });
      const events = await tx.select().from(outboxDeliveryEvents).where(eq(outboxDeliveryEvents.outboxId, outboxId));
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ kind: "hard_bounce", reason: "address_unknown" });
      expect(await statusOf(tx, outboxId)).toBe("hard_bounced");

      const file = (await tx.select().from(schema.students).where(eq(schema.students.id, studentId)))[0]!;
      expect(file.emailInvalidAt?.toISOString()).toBe("2026-10-31T15:00:00.000Z");

      const trail = await tx.select().from(auditLog).where(eq(auditLog.targetId, studentId));
      expect(trail).toHaveLength(1);
      expect(trail[0]).toMatchObject({
        actorId: BREVO_AUDIT_ACTOR,
        action: "student.email_marked_invalid",
        metadata: { reason: "address_unknown" },
      });
      // The log keeps what changed, never the address (CLAUDE.md §8).
      expect(JSON.stringify(trail[0]!.metadata)).not.toContain("rosa.bounce");
    });
  });

  it("records the same event once — Brevo retries a webhook it did not see answered", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { outboxId } = await seed(tx);
      const recorder = new DrizzleEmailDeliveryRepository(tx);
      const bounce = event("hard_bounce", "2026-10-31T15:00:00.000Z", "address_unknown");

      await recorder.record(bounce);
      expect(await recorder.record(bounce)).toEqual({ kind: "duplicate" });

      const events = await tx.select().from(outboxDeliveryEvents).where(eq(outboxDeliveryEvents.outboxId, outboxId));
      expect(events).toHaveLength(1);
    });
  });

  it("ignores a message no outbox row carries", async () => {
    await inRolledBackTransaction(async (tx) => {
      const outcome = await new DrizzleEmailDeliveryRepository(tx).record(event("delivered", "2026-10-31T15:00:00.000Z"));
      expect(outcome).toEqual({ kind: "unknown_message" });
    });
  });

  it.each([
    ["a retry that finally delivers beats the soft bounce before it", ["soft_bounce", "delivered"], "delivered"],
    ["a late soft bounce does not undo a delivery", ["delivered", "soft_bounce"], "delivered"],
    ["a hard bounce is the end of the story", ["hard_bounce", "delivered"], "hard_bounced"],
  ] as const)("the status only moves up: %s", async (_label, kinds, expected) => {
    await inRolledBackTransaction(async (tx) => {
      const { outboxId } = await seed(tx);
      const recorder = new DrizzleEmailDeliveryRepository(tx);

      for (const [index, kind] of kinds.entries()) {
        await recorder.record(event(kind, `2026-10-31T15:0${index}:00.000Z`, kind === "delivered" ? null : "other"));
      }

      expect(await statusOf(tx, outboxId)).toBe(expected);
      // The history keeps every line even when the status does not move.
      const events = await tx.select().from(outboxDeliveryEvents).where(eq(outboxDeliveryEvents.outboxId, outboxId));
      expect(events).toHaveLength(kinds.length);
    });
  });

  it("does not flag a file for a soft bounce or a delivery", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { studentId } = await seed(tx);
      const recorder = new DrizzleEmailDeliveryRepository(tx);

      expect(await recorder.record(event("soft_bounce", "2026-10-31T15:00:00.000Z", "mailbox_full"))).toEqual({
        kind: "recorded",
        studentsMarked: 0,
      });

      const file = (await tx.select().from(schema.students).where(eq(schema.students.id, studentId)))[0]!;
      expect(file.emailInvalidAt).toBeNull();
    });
  });

  it("flags only the file whose current e-mail is the one that bounced, and keeps the first date", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { studentId } = await seed(tx, "someone.else@gmail.com");
      const recorder = new DrizzleEmailDeliveryRepository(tx);

      // The message went to an address that is not on the file (the student corrected it since).
      expect(await recorder.record(event("hard_bounce", "2026-10-31T15:00:00.000Z", "address_unknown"))).toEqual({
        kind: "recorded",
        studentsMarked: 0,
      });
      const file = (await tx.select().from(schema.students).where(eq(schema.students.id, studentId)))[0]!;
      expect(file.emailInvalidAt).toBeNull();
    });
  });

  it("matches the address regardless of case", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { studentId } = await seed(tx, ADDRESS.toUpperCase());

      await new DrizzleEmailDeliveryRepository(tx).record(event("hard_bounce", "2026-10-31T15:00:00.000Z", "address_unknown"));

      const file = (await tx.select().from(schema.students).where(eq(schema.students.id, studentId)))[0]!;
      expect(file.emailInvalidAt).not.toBeNull();
    });
  });

  it("clears the flag when the file's e-mail changes, and keeps it when it does not", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { studentId } = await seed(tx);
      await new DrizzleEmailDeliveryRepository(tx).record(event("hard_bounce", "2026-10-31T15:00:00.000Z", "address_unknown"));
      const students = new DrizzleStudentRepository(tx);

      const corrected = (await students.findById(studentId))!;
      corrected.rewrite({ ...fields(corrected), lastName: "Bounce Quispe" });
      await students.update(corrected);
      expect((await flagOf(tx, studentId))).not.toBeNull();

      const moved = (await students.findById(studentId))!;
      moved.rewrite({ ...fields(moved), email: "rosa.new.integration@gmail.com" });
      await students.update(moved);
      expect(await flagOf(tx, studentId)).toBeNull();
    });
  });
});

const flagOf = async (tx: Db, id: string) =>
  (await tx.select({ at: schema.students.emailInvalidAt }).from(schema.students).where(eq(schema.students.id, id)))[0]?.at;

function fields(student: Student) {
  return {
    firstName: student.firstName,
    lastName: student.lastName,
    nationalIdType: student.nationalIdType,
    nationalId: student.nationalId,
    email: student.email,
    phone: student.phone,
    birthDate: student.birthDate,
    country: student.country,
    region: student.region,
    city: student.city,
  };
}
