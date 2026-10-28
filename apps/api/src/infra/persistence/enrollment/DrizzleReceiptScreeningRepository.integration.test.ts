import * as schema from "@ooc/db";
import {
  academicPeriods,
  classGroups,
  courses,
  enrollments,
  outbox,
  payments,
  planPrices,
  plans,
  receiptUploads,
  seatHolds,
  students,
} from "@ooc/db";
import { OperationNumberAlreadyUsedError, type EmailNotification, type PaymentMethod } from "@ooc/domain";
import { eq, like } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/infra/db/client.js";
import { fingerprintDistance, SIMILAR_IMAGE_MAX_DISTANCE } from "@/infra/storage/fingerprintReceiptImage.js";
import { DrizzleReceiptScreeningRepository } from "./DrizzleReceiptScreeningRepository.js";
import { assertOperationNumberUnused } from "./operationNumberGuard.js";

/**
 * The receipt antifraud's SQL (OOC-22) — the part typecheck cannot vouch
 * for: the operation-number expression has to agree with
 * `normalizeOperationNumber`, and the lookalike query has to agree with
 * `fingerprintDistance` bit for bit, signed bigints included.
 *
 * Runs against a real, migrated Postgres (`pnpm test:api:db`). `payments`
 * is under the delete lock of migration 0011, so nothing here can be
 * cleaned up afterwards: every test runs inside a transaction that is always
 * rolled back, and the repository is handed that transaction — its own
 * `transaction()` becomes a savepoint inside it.
 */

const { Pool } = pg;

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is required: this suite exercises the receipt antifraud SQL against a real, migrated Postgres.",
  );
}

const PERIOD = "018f2b5c-6000-7000-8000-000000000001";
const COURSE = "018f2b5c-6000-7000-8000-000000000002";
const PLAN = "018f2b5c-6000-7000-8000-000000000003";
const PLAN_PRICE = "018f2b5c-6000-7000-8000-000000000004";
const GROUP = "018f2b5c-6000-7000-8000-000000000005";

let pool: pg.Pool;
let db: Db;

beforeAll(() => {
  pool = new Pool({ connectionString: DATABASE_URL, max: 2 });
  db = drizzle(pool, { schema, casing: "snake_case" });
});

afterAll(async () => {
  await pool.end();
});

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

class RolledBack extends Error {}

async function rolledBack(fn: (tx: Tx) => Promise<void>): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      await seedCatalog(tx);
      await fn(tx);
      throw new RolledBack();
    });
  } catch (error) {
    if (!(error instanceof RolledBack)) {
      throw error;
    }
  }
}

async function seedCatalog(tx: Tx): Promise<void> {
  await tx.insert(academicPeriods).values({
    id: PERIOD,
    name: "Ciclo de prueba (receipt antifraud integration)",
    startsOn: new Date("2026-03-01T00:00:00.000Z"),
    endsOn: new Date("2026-07-31T00:00:00.000Z"),
  });
  await tx.insert(courses).values({ id: COURSE, name: "Curso (antifraud integration)", language: "Prueba", minAge: 12 });
  await tx.insert(plans).values({ id: PLAN, courseId: COURSE, name: "Paquete completo" });
  await tx.insert(planPrices).values({ id: PLAN_PRICE, planId: PLAN, amountCents: 15000 });
  await tx.insert(classGroups).values({
    id: GROUP,
    courseId: COURSE,
    academicPeriodId: PERIOD,
    schedule: "Lun/Mié 19:00",
    startsOn: new Date("2026-03-02T00:00:00.000Z"),
    endsOn: new Date("2026-06-30T00:00:00.000Z"),
    capacity: 50,
  });
}

let sequence = 0;

/** A student, enrollment and payment — what a submit leaves behind. */
async function payment(
  tx: Tx,
  params: { method?: PaymentMethod; operationNumber?: string | null; status?: string } = {},
): Promise<string> {
  const n = ++sequence;
  const [student] = await tx
    .insert(students)
    .values({
      firstName: `Alumno${n}`,
      lastName: "Antifraude",
      nationalIdType: "DNI",
      nationalId: `ANTIFRAUD${n}`,
      email: `antifraud.${n}@gmail.com`,
      phone: "+51900000000",
      birthDate: new Date("2000-01-01T00:00:00.000Z"),
      country: "PE",
      city: "Lima",
    })
    .returning({ id: students.id });
  const [enrollment] = await tx
    .insert(enrollments)
    .values({ studentId: student!.id, classGroupId: GROUP, planPriceId: PLAN_PRICE, origin: "web" })
    .returning({ id: enrollments.id });
  const [row] = await tx
    .insert(payments)
    .values({
      enrollmentId: enrollment!.id,
      idempotencyKey: `antifraud-integration-${n}`,
      status: params.status ?? "pending",
      // A decided payment always says when (payments_decided_at_check).
      decidedAt: params.status === "approved" || params.status === "rejected" ? new Date() : null,
      method: params.method ?? "yape",
      amountCents: 15000,
      operationNumber: params.operationNumber === undefined ? `AFI${n}X` : params.operationNumber,
    })
    .returning({ id: payments.id });
  return row!.id;
}

/** The e-mail the usecase hands over when the screening routes to review. */
function underReview(paymentId: string): EmailNotification[] {
  return [
    {
      templateKey: "payment_under_review",
      to: "student@gmail.com",
      locale: "es-PE",
      vars: { recipientName: "Alumno", studentName: "Alumno Antifraude", courseName: "Curso" },
      dedupeKey: `payment_under_review:${paymentId}:student`,
    },
  ];
}

/** What reached the outbox about a payment — only a real move writes it. */
async function emailsAbout(tx: Tx, paymentId: string): Promise<string[]> {
  const rows = await tx.select({ templateKey: outbox.templateKey }).from(outbox).where(like(outbox.dedupeKey, `%:${paymentId}:%`));
  return rows.map((row) => row.templateKey);
}

interface Print {
  sha256: string;
  phash: bigint;
  crops: bigint[];
}

/** A processed receipt upload with the given fingerprint, attached to
 * `paymentId` (or to nothing — a checkout that never submitted). */
async function receipt(tx: Tx, print: Print, paymentId: string | null): Promise<string> {
  const n = ++sequence;
  const [hold] = await tx
    .insert(seatHolds)
    .values({ classGroupId: GROUP, origin: "web", status: "released", expiresAt: new Date(), settledAt: new Date() })
    .returning({ id: seatHolds.id });
  const [row] = await tx
    .insert(receiptUploads)
    .values({
      seatHoldId: hold!.id,
      paymentId,
      objectKey: `receipts/raw/antifraud-integration/${n}`,
      status: "processed",
      processedObjectKey: `receipts/processed/antifraud-integration/${n}.jpg`,
      imageSha256: print.sha256,
      imagePhash: print.phash,
      imagePhashCrops: print.crops,
    })
    .returning({ id: receiptUploads.id });
  return row!.id;
}

/** `base` with the lowest `bits` bits flipped. */
function flip(base: bigint, bits: number): bigint {
  return BigInt.asIntN(64, base ^ ((1n << BigInt(bits)) - 1n));
}

// High bit set on purpose: the signed-bigint round trip is where a
// sign-extension bug would hide.
const BASE = BigInt.asIntN(64, 0xf0e1_d2c3_b4a5_9687n);
const UNRELATED = BigInt.asIntN(64, ~BASE);

function print(sha: string, phash: bigint, crops: bigint[] = [UNRELATED]): Print {
  return { sha256: sha.padEnd(64, "0"), phash, crops };
}

describe("assertOperationNumberUnused", () => {
  it("refuses a number another payment of the same method already used, however it is typed", async () => {
    await rolledBack(async (tx) => {
      await payment(tx, { method: "yape", operationNumber: "0831-2457" });

      await expect(assertOperationNumberUnused(tx, { method: "yape", operationNumber: "08312457" })).rejects.toBeInstanceOf(
        OperationNumberAlreadyUsedError,
      );
      await expect(
        assertOperationNumberUnused(tx, { method: "yape", operationNumber: " 0831 2457 " }),
      ).rejects.toBeInstanceOf(OperationNumberAlreadyUsedError);
    });
  });

  it("is case-insensitive for alphanumeric numbers", async () => {
    await rolledBack(async (tx) => {
      await payment(tx, { method: "bcp", operationNumber: "ab12cd34" });

      await expect(assertOperationNumberUnused(tx, { method: "bcp", operationNumber: "AB12-CD34" })).rejects.toBeInstanceOf(
        OperationNumberAlreadyUsedError,
      );
    });
  });

  it("lets the same number through on another method (decision 30/09/2026)", async () => {
    await rolledBack(async (tx) => {
      await payment(tx, { method: "plin", operationNumber: "451267" });

      await expect(assertOperationNumberUnused(tx, { method: "bcp", operationNumber: "451267" })).resolves.toBeUndefined();
    });
  });

  it("counts a rejected payment's number as spent", async () => {
    await rolledBack(async (tx) => {
      await payment(tx, { method: "yape", operationNumber: "77712345", status: "rejected" });

      await expect(assertOperationNumberUnused(tx, { method: "yape", operationNumber: "77712345" })).rejects.toBeInstanceOf(
        OperationNumberAlreadyUsedError,
      );
    });
  });

  it("lets a fresh number through", async () => {
    await rolledBack(async (tx) => {
      await payment(tx, { method: "yape", operationNumber: "11112222" });

      await expect(assertOperationNumberUnused(tx, { method: "yape", operationNumber: "11112223" })).resolves.toBeUndefined();
    });
  });
});

describe("DrizzleReceiptScreeningRepository", () => {
  it("finds the same file attached to another payment as identical", async () => {
    await rolledBack(async (tx) => {
      const repository = new DrizzleReceiptScreeningRepository(tx as unknown as Db);
      const original = await receipt(tx, print("aa", BASE), await payment(tx));
      const resent = await receipt(tx, print("aa", BASE), await payment(tx));

      const subject = await repository.findSubject(resent);
      const lookalikes = await repository.findLookalikes(subject!);

      expect(lookalikes.find((l) => l.receiptUploadId === original)?.match).toEqual({ kind: "identical" });
    });
  });

  it("agrees with fingerprintDistance on whole-vs-whole, whole-vs-crop and crop-vs-whole", async () => {
    await rolledBack(async (tx) => {
      const repository = new DrizzleReceiptScreeningRepository(tx as unknown as Db);

      const subjectPrint = print("b0", BASE, [flip(BASE, 40)]);
      const cases: Array<[string, Print]> = [
        ["whole vs whole", print("b1", flip(BASE, 2))],
        // The other receipt is a crop of the subject's whole image.
        ["subject whole vs other crop", print("b2", UNRELATED, [flip(BASE, 4)])],
        // The subject is a crop of the other receipt's whole image.
        ["subject crop vs other whole", print("b3", flip(BASE, 40 - 5), [UNRELATED])],
        ["out of range", print("b4", flip(BASE, SIMILAR_IMAGE_MAX_DISTANCE + 1), [UNRELATED])],
      ];

      const idOf = new Map<string, string>();
      for (const [label, other] of cases) {
        idOf.set(label, await receipt(tx, other, await payment(tx)));
      }
      const subjectId = await receipt(tx, subjectPrint, await payment(tx));

      const lookalikes = await repository.findLookalikes((await repository.findSubject(subjectId))!);
      const distanceOf = (label: string) => {
        const match = lookalikes.find((l) => l.receiptUploadId === idOf.get(label))?.match;
        return match?.kind === "similar" ? match.distance : undefined;
      };

      for (const [label, other] of cases) {
        const expected = fingerprintDistance(subjectPrint, other);
        expect(distanceOf(label), label).toBe(expected <= SIMILAR_IMAGE_MAX_DISTANCE ? expected : undefined);
      }
    });
  });

  it("ignores its own payment, and copies that never reached a payment", async () => {
    await rolledBack(async (tx) => {
      const repository = new DrizzleReceiptScreeningRepository(tx as unknown as Db);
      const paymentId = await payment(tx);
      // The same photo uploaded in a checkout whose hold ran out.
      const abandoned = await receipt(tx, print("cc", BASE), null);
      // A second upload for the same payment.
      const sibling = await receipt(tx, print("cc", BASE), paymentId);
      const subjectId = await receipt(tx, print("cc", BASE), paymentId);

      const lookalikes = await repository.findLookalikes((await repository.findSubject(subjectId))!);
      const ids = lookalikes.map((l) => l.receiptUploadId);

      expect(ids).not.toContain(abandoned);
      expect(ids).not.toContain(sibling);
    });
  });

  it("stamps once, and routes a pending payment to under_review only when asked", async () => {
    await rolledBack(async (tx) => {
      const repository = new DrizzleReceiptScreeningRepository(tx as unknown as Db);
      const routedPayment = await payment(tx);
      const routed = await receipt(tx, print("d1", BASE), routedPayment);
      const quietPayment = await payment(tx);
      const quiet = await receipt(tx, print("d2", UNRELATED), quietPayment);

      expect(await repository.findSubject(routed)).toMatchObject({ classGroupId: GROUP, studentId: expect.any(String) });

      await repository.recordScreening({
        receiptUploadId: routed,
        paymentId: routedPayment,
        signals: [{ kind: "edited_with_software", software: "GIMP" }],
        routeToReview: true,
        notifications: underReview(routedPayment),
      });
      await repository.recordScreening({
        receiptUploadId: quiet,
        paymentId: quietPayment,
        signals: [{ kind: "similar_image", receiptUploadId: routed, paymentId: routedPayment, distance: 3 }],
        routeToReview: false,
        notifications: [],
      });

      const statusOf = async (id: string) =>
        (await tx.select({ status: payments.status }).from(payments).where(eq(payments.id, id)))[0]?.status;
      expect(await statusOf(routedPayment)).toBe("under_review");
      expect(await statusOf(quietPayment)).toBe("pending");
      expect(await emailsAbout(tx, routedPayment)).toEqual(["payment_under_review"]);
      expect(await emailsAbout(tx, quietPayment)).toEqual([]);

      const [stamped] = await tx
        .select({ fraudSignals: receiptUploads.fraudSignals, screenedAt: receiptUploads.screenedAt })
        .from(receiptUploads)
        .where(eq(receiptUploads.id, quiet));
      expect(stamped?.screenedAt).not.toBeNull();
      expect(stamped?.fraudSignals).toEqual([
        { kind: "similar_image", receiptUploadId: routed, paymentId: routedPayment, distance: 3 },
      ]);

      // Screened rows are no longer subjects, and a redelivered job changes
      // nothing.
      expect(await repository.findSubject(quiet)).toBeNull();
      await repository.recordScreening({
        receiptUploadId: quiet,
        paymentId: quietPayment,
        signals: [],
        routeToReview: true,
        notifications: underReview(quietPayment),
      });
      expect(await statusOf(quietPayment)).toBe("pending");
      expect(await emailsAbout(tx, quietPayment)).toEqual([]);
    });
  });

  it("leaves a payment already past pending where it is", async () => {
    await rolledBack(async (tx) => {
      const repository = new DrizzleReceiptScreeningRepository(tx as unknown as Db);
      const approved = await payment(tx, { status: "approved" });
      const upload = await receipt(tx, print("e1", BASE), approved);

      await repository.recordScreening({
        receiptUploadId: upload,
        paymentId: approved,
        signals: [{ kind: "edited_with_software", software: "GIMP" }],
        routeToReview: true,
        notifications: underReview(approved),
      });

      const [row] = await tx.select({ status: payments.status }).from(payments).where(eq(payments.id, approved));
      expect(row?.status).toBe("approved");
      expect(await emailsAbout(tx, approved)).toEqual([]);
    });
  });
});
