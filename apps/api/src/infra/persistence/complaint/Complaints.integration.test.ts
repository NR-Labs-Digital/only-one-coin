import * as schema from "@ooc/db";
import { complaints, outbox } from "@ooc/db";
import { ComplaintFormSchema, FileComplaintUseCase } from "@ooc/domain";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/infra/db/client.js";
import { DrizzleComplaintRepository } from "./DrizzleComplaintRepository.js";

/**
 * The complaints book (OOC-63) against a real, migrated Postgres: the sheet
 * and its copy in one transaction, the number from the sequence, and a
 * resend under the same idempotency key filing nothing new. Every test runs
 * inside a transaction that is always rolled back.
 */

const { Pool } = pg;
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is required: this suite exercises the complaints book against a real, migrated Postgres.");
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

const form = (isMinor: boolean) =>
  ComplaintFormSchema.parse({
    kind: "grievance",
    consumer: {
      firstName: "Ana",
      lastName: "Pérez",
      secondLastName: null,
      nationalIdType: "DNI",
      nationalId: "12345678",
      phone: "987654321",
      email: "ana.integration@example.com",
      department: "Lima",
      province: "Lima",
      district: "Miraflores",
      address: "Av. Larco 123",
      addressReference: null,
      isMinor,
    },
    guardian: isMinor ? { firstName: "Rosa", lastName: "Rojas", nationalIdType: "DNI", nationalId: "41234567" } : null,
    goodType: "service",
    amountCents: null,
    purchasedOn: null,
    description: "Atención",
    detail: "Nadie respondió.",
    request: "Que me respondan.",
    truthfulnessAccepted: true,
    privacyAccepted: true,
  });

const KEY_A = "018f2b5c-9100-7000-8000-00000000c1a1";
const KEY_B = "018f2b5c-9100-7000-8000-00000000c1a2";

describe("DrizzleComplaintRepository", () => {
  it("files the sheet with a correlative number and queues the consumer's copy", async () => {
    await inRolledBackTransaction(async (tx) => {
      const useCase = new FileComplaintUseCase(new DrizzleComplaintRepository(tx));
      const first = await useCase.run({ form: form(true), locale: "pt-BR", ip: "203.0.113.9", idempotencyKey: KEY_A });
      const second = await useCase.run({ form: form(false), locale: "es-PE", ip: "203.0.113.9", idempotencyKey: KEY_B });

      expect(first.code).toMatch(/^\d{4}-\d{6,}$/);
      expect(Number(second.code.split("-")[1])).toBeGreaterThan(Number(first.code.split("-")[1]));

      const [row] = await tx.select().from(complaints).where(eq(complaints.id, first.id));
      expect(row).toMatchObject({
        kind: "grievance",
        consumerIsMinor: true,
        guardianNationalId: "41234567",
        consumerIp: "203.0.113.9",
        locale: "pt-BR",
      });

      const copies = await tx.select().from(outbox).where(eq(outbox.dedupeKey, `complaint_filed:${first.id}`));
      expect(copies).toHaveLength(1);
      expect(copies[0]).toMatchObject({ templateKey: "complaint_filed", recipient: "ana.integration@example.com", locale: "pt-BR" });
    });
  });

  it("answers a resend under the same key with the same sheet, and writes nothing", async () => {
    await inRolledBackTransaction(async (tx) => {
      const useCase = new FileComplaintUseCase(new DrizzleComplaintRepository(tx));
      const first = await useCase.run({ form: form(false), locale: "es-PE", ip: "203.0.113.9", idempotencyKey: KEY_A });
      const again = await useCase.run({ form: form(false), locale: "es-PE", ip: "203.0.113.9", idempotencyKey: KEY_A });

      expect(again).toEqual(first);
      expect(await useCase.findFiled(KEY_A)).toEqual(first);
      expect(await tx.select().from(complaints).where(eq(complaints.idempotencyKey, KEY_A))).toHaveLength(1);
    });
  });
});
