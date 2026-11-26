import * as schema from "@ooc/db";
import { auditLog, complaintEvents, outbox, students } from "@ooc/db";
import {
  ComplaintAlreadyAnsweredError,
  ComplaintAlreadyTakenError,
  ComplaintFormSchema,
  FileComplaintUseCase,
  complaintAnsweredEmails,
} from "@ooc/domain";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq, sql } from "drizzle-orm";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/infra/db/client.js";
import { DrizzleComplaintInboxRepository } from "./DrizzleComplaintInboxRepository.js";
import { DrizzleComplaintRepository } from "./DrizzleComplaintRepository.js";

/**
 * The complaints book's inbox (OOC-58) against a real, migrated Postgres: the
 * sheet read whole with its steps, the link to a student file by the
 * document (a raw one written before OOC-64 included), and each step written
 * once with its audit entry — the answer with its e-mail. Every test runs
 * inside a transaction that is always rolled back.
 */

const { Pool } = pg;
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is required: this suite exercises the complaints inbox against a real, migrated Postgres.");
}

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

const STAFF = "ooc58-staff";
const STUDENT_ID = "018f2b5c-9100-7000-8000-00000000c5a1";

const form = (nationalId: string) =>
  ComplaintFormSchema.parse({
    kind: "claim",
    consumer: {
      firstName: "Ana",
      lastName: "Pérez",
      secondLastName: "Rojas",
      nationalIdType: "DNI",
      nationalId,
      phone: "987654321",
      email: "ana.ooc58@example.com",
      department: "Lima",
      province: "Lima",
      district: "Miraflores",
      address: "Av. Larco 123",
      addressReference: null,
      isMinor: false,
    },
    guardian: null,
    goodType: "service",
    amountCents: 25000,
    purchasedOn: "2026-11-02",
    description: "Clase",
    detail: "No pude entrar al aula.",
    request: "Que me den acceso.",
    truthfulnessAccepted: true,
    privacyAccepted: true,
  });

async function seed(tx: Db) {
  await tx.execute(
    sql`insert into "user" ("id", "name", "email", "emailVerified", "role", "createdAt", "updatedAt")
        values (${STAFF}, 'Atención OOC-58', 'ooc58.staff@test.local', true, 'support', now(), now())`,
  );
  // A file written before OOC-64: the document still carries its dots.
  await tx.insert(students).values({
    id: STUDENT_ID,
    firstName: "Ana",
    lastName: "Pérez",
    nationalIdType: "DNI",
    nationalId: "58.123.456",
    email: "ana.ooc58@gmail.com",
    phone: "+51900000000",
    birthDate: new Date("2000-01-01T00:00:00.000Z"),
    country: "PE",
    city: "Lima",
  });
  const sheets = new FileComplaintUseCase(new DrizzleComplaintRepository(tx));
  const linked = await sheets.run({
    form: form("58123456"),
    locale: "pt-BR",
    ip: "203.0.113.5",
    idempotencyKey: "018f2b5c-9100-7000-8000-00000000c5b1",
  });
  const loose = await sheets.run({
    form: form("70000001"),
    locale: "es-PE",
    ip: "203.0.113.5",
    idempotencyKey: "018f2b5c-9100-7000-8000-00000000c5b2",
  });
  return { linked, loose };
}

describe("DrizzleComplaintInboxRepository", () => {
  it("reads the sheet whole, linked to the file with the same document, the other one loose", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { linked, loose } = await seed(tx);
      const inbox = new DrizzleComplaintInboxRepository(tx);

      const record = await inbox.findById(linked.id);
      expect(record).toMatchObject({
        code: linked.code,
        kind: "claim",
        locale: "pt-BR",
        amountCents: 25000,
        purchasedOn: "2026-11-02",
        consumer: { nationalId: "58123456", secondLastName: "Rojas", isMinor: false },
        guardian: null,
        taken: null,
        answered: null,
        student: { studentId: STUDENT_ID, fullName: "Ana Pérez" },
      });
      expect((await inbox.findById(loose.id))?.student).toBeNull();

      const forStudent = await inbox.listForStudent(STUDENT_ID);
      expect(forStudent.map((item) => item.id)).toEqual([linked.id]);
      const all = (await inbox.list()).map((item) => item.id);
      expect(all).toContain(linked.id);
      expect(all).toContain(loose.id);
    });
  });

  it("takes a sheet once, with its audit entry", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { linked } = await seed(tx);
      const inbox = new DrizzleComplaintInboxRepository(tx);

      await inbox.take({ complaintId: linked.id, actorId: STAFF });
      await expect(inbox.take({ complaintId: linked.id, actorId: STAFF })).rejects.toBeInstanceOf(
        ComplaintAlreadyTakenError,
      );

      const record = await inbox.findById(linked.id);
      expect(record?.taken).toMatchObject({ actorName: "Atención OOC-58" });
      const audits = await tx.select().from(auditLog).where(eq(auditLog.targetId, linked.id));
      expect(audits.map((entry) => entry.action)).toEqual(["complaint.taken"]);
    });
  });

  it("answers once: the step, the e-mail in the form's language and the audit entry", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { linked } = await seed(tx);
      const inbox = new DrizzleComplaintInboxRepository(tx);
      const record = (await inbox.findById(linked.id))!;

      await inbox.answer({
        complaintId: linked.id,
        actorId: STAFF,
        answer: "Já liberamos o acesso.",
        emails: complaintAnsweredEmails(record, "Já liberamos o acesso."),
      });
      await expect(
        inbox.answer({ complaintId: linked.id, actorId: STAFF, answer: "Outra", emails: [] }),
      ).rejects.toBeInstanceOf(ComplaintAlreadyAnsweredError);
      // Taking after the answer is refused too: the steps keep their order.
      await expect(inbox.take({ complaintId: linked.id, actorId: STAFF })).rejects.toBeInstanceOf(
        ComplaintAlreadyAnsweredError,
      );

      const answered = await inbox.findById(linked.id);
      expect(answered?.answered).toMatchObject({ answer: "Já liberamos o acesso.", actorName: "Atención OOC-58" });
      expect(answered?.taken).toBeNull();

      const [email] = await tx.select().from(outbox).where(eq(outbox.dedupeKey, `complaint_answered:${linked.id}`));
      expect(email).toMatchObject({ templateKey: "complaint_answered", recipient: "ana.ooc58@example.com", locale: "pt-BR" });

      const audits = await tx.select().from(auditLog).where(eq(auditLog.targetId, linked.id));
      expect(audits.map((entry) => entry.action)).toEqual(["complaint.answered"]);
      // The answer itself never travels to the audit log.
      expect(JSON.stringify(audits[0]!.metadata)).not.toContain("acesso");

      const steps = await tx.select().from(complaintEvents).where(eq(complaintEvents.complaintId, linked.id));
      expect(steps).toHaveLength(1);
    });
  });

  it("refuses an answer the CHECK does not allow", async () => {
    await inRolledBackTransaction(async (tx) => {
      const { linked } = await seed(tx);
      await expect(
        tx.execute(
          sql`insert into complaint_events (complaint_id, kind, answer, actor_id) values (${linked.id}, 'taken', 'x', ${STAFF})`,
        ),
      ).rejects.toThrow();
    });
  });
});
