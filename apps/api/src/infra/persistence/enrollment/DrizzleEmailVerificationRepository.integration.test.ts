import { randomUUID } from "node:crypto";
import * as schema from "@ooc/db";
import { academicPeriods, classGroups, courses, emailVerifications, outbox, seatHolds } from "@ooc/db";
import { emailVerificationCodeEmail, hashVerificationCode } from "@ooc/domain";
import { eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/infra/db/client.js";
import { DrizzleEmailVerificationRepository, consumeVerifiedEmail } from "./DrizzleEmailVerificationRepository.js";
import { DrizzleSeatHoldRepository } from "./DrizzleSeatHoldRepository.js";
import { seedModuleRuns } from "@/tests/fixtures/classGroupModules.js";

/**
 * The checkout's e-mail proof in SQL (spec 2026-10-07): the code row and its
 * e-mail written together, cooldown and send cap per hold, expiry and attempts
 * on the database clock, and a proof consumed exactly once.
 *
 * Runs against a real, migrated Postgres (`pnpm test:api:db`).
 */

const { Pool } = pg;
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is required: this suite exercises DrizzleEmailVerificationRepository against a real, migrated Postgres.");
}

const PERIOD = "018f2b5c-7100-7000-8000-000000000001";
const COURSE = "018f2b5c-7100-7000-8000-000000000002";
const GROUP = "018f2b5c-7100-7000-8000-000000000003";
const EMAIL = "verify.integration@gmail.com";

let pool: pg.Pool;
let db: Db;
let repository: DrizzleEmailVerificationRepository;
let holdId: string;

beforeAll(() => {
  pool = new Pool({ connectionString: DATABASE_URL, max: 2 });
  db = drizzle(pool, { schema, casing: "snake_case" });
  repository = new DrizzleEmailVerificationRepository(db);
});

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await cleanUp();
  await db.insert(academicPeriods).values({
    id: PERIOD,
    name: "Ciclo de prueba (email verification integration)",
    startsOn: new Date("2026-03-01T00:00:00.000Z"),
    endsOn: new Date("2026-07-31T00:00:00.000Z"),
  });
  await db.insert(courses).values({ id: COURSE, name: "Curso (email verification)", language: "Lengua de prueba", minAge: 12 });
  await db.insert(classGroups).values({
    id: GROUP,
    status: "enrolling",
    courseId: COURSE,
    academicPeriodId: PERIOD,
    schedule: "Lun/Mié 19:00",
    startsOn: new Date("2026-03-02T00:00:00.000Z"),
    endsOn: new Date("2026-06-30T00:00:00.000Z"),
    capacity: 5,
  });
  await seedModuleRuns(db);
  const claimed = await new DrizzleSeatHoldRepository(db).claim({ classGroupId: GROUP, origin: "web", holdMinutes: 15 });
  if (claimed.kind !== "held") throw new Error("fixture hold not taken");
  holdId = claimed.hold.id;
});

afterEach(async () => {
  await cleanUp();
});

async function cleanUp(): Promise<void> {
  const holds = db.select({ id: seatHolds.id }).from(seatHolds).where(eq(seatHolds.classGroupId, GROUP));
  const ids = await db.select({ id: emailVerifications.id }).from(emailVerifications).where(inArray(emailVerifications.seatHoldId, holds));
  if (ids.length > 0) {
    await db.delete(outbox).where(inArray(outbox.dedupeKey, ids.map(({ id }) => `email_verification_code:${id}:student`)));
  }
  await db.delete(emailVerifications).where(inArray(emailVerifications.seatHoldId, holds));
  await db.delete(seatHolds).where(eq(seatHolds.classGroupId, GROUP));
  await db.delete(schema.classGroupModules).where(eq(schema.classGroupModules.classGroupId, GROUP));
  await db.delete(classGroups).where(eq(classGroups.id, GROUP));
  await db.delete(courses).where(eq(courses.id, COURSE));
  await db.delete(academicPeriods).where(eq(academicPeriods.id, PERIOD));
}

function request(code = "123456", overrides: Partial<{ cooldownSeconds: number; maxSends: number }> = {}) {
  // apps/api has no `uuid` dependency; a v4 id is as good as v7 for the column.
  const id = randomUUID();
  return {
    id,
    seatHoldId: holdId,
    email: EMAIL,
    codeHash: hashVerificationCode(id, code),
    ttlMinutes: 10,
    cooldownSeconds: overrides.cooldownSeconds ?? 60,
    maxSends: overrides.maxSends ?? 5,
    notifications: [emailVerificationCodeEmail({ verificationId: id, to: EMAIL, recipientName: "Rosa", code, locale: "es-PE" as const })],
  };
}

/** Pretends every code of the hold was sent long ago (past the cooldown). */
async function ageSends(): Promise<void> {
  await db
    .update(emailVerifications)
    .set({ createdAt: sql`now() - interval '2 minutes'` })
    .where(eq(emailVerifications.seatHoldId, holdId));
}

describe("DrizzleEmailVerificationRepository.issue", () => {
  it("writes the row and its e-mail together, expiring on the database clock", async () => {
    const issued = request();
    expect(await repository.issue(issued)).toBe("issued");

    const [row] = await db
      .select({ expiresInSeconds: sql<number>`extract(epoch from ${emailVerifications.expiresAt} - now())::int` })
      .from(emailVerifications)
      .where(eq(emailVerifications.id, issued.id));
    expect(row!.expiresInSeconds).toBeGreaterThan(9 * 60);
    expect(row!.expiresInSeconds).toBeLessThanOrEqual(10 * 60);

    const mails = await db.select().from(outbox).where(eq(outbox.dedupeKey, `email_verification_code:${issued.id}:student`));
    expect(mails).toHaveLength(1);
  });

  it("refuses inside the cooldown and past the send cap", async () => {
    expect(await repository.issue(request())).toBe("issued");
    expect(await repository.issue(request())).toBe("cooldown");

    await ageSends();
    expect(await repository.issue(request("123456", { maxSends: 1 }))).toBe("too_many_sends");
  });

  it("refuses a hold that is no longer alive and writes nothing", async () => {
    await db.update(seatHolds).set({ expiresAt: sql`now() - interval '1 second'` }).where(eq(seatHolds.id, holdId));
    const issued = request();
    expect(await repository.issue(issued)).toBe("hold_expired");
    expect(await db.select().from(emailVerifications).where(eq(emailVerifications.id, issued.id))).toHaveLength(0);
  });

  it("expires the pending code when a new one goes out", async () => {
    const first = request("111111");
    await repository.issue(first);
    await ageSends();
    await repository.issue(request("222222"));

    const [firstNow] = await db
      .select({ expired: sql<boolean>`${emailVerifications.expiresAt} <= now()` })
      .from(emailVerifications)
      .where(eq(emailVerifications.id, first.id));
    expect(firstNow!.expired).toBe(true);

    const latest = await repository.findLatest({ seatHoldId: holdId, email: EMAIL });
    expect(latest!.codeHash).toBe(hashVerificationCode(latest!.id, "222222"));
  });
});

describe("cleanUp", () => {
  it("removes the outbox rows of this suite's verifications", async () => {
    const issued = request();
    await repository.issue(issued);
    const key = `email_verification_code:${issued.id}:student`;
    expect(await db.select().from(outbox).where(eq(outbox.dedupeKey, key))).toHaveLength(1);

    await cleanUp();

    expect(await db.select().from(outbox).where(eq(outbox.dedupeKey, key))).toHaveLength(0);
  });
});

describe("attempts, verification and consumption", () => {
  it("claims attempts up to the cap, then refuses", async () => {
    const issued = request();
    await repository.issue(issued);
    for (let i = 1; i <= 5; i++) expect(await repository.claimAttempt(issued.id)).toBe(i);
    expect(await repository.claimAttempt(issued.id)).toBeNull();
  });

  it("does not claim an attempt on an expired or a verified row", async () => {
    const expired = request();
    await repository.issue(expired);
    await db.update(emailVerifications).set({ expiresAt: sql`now() - interval '1 second'` }).where(eq(emailVerifications.id, expired.id));
    expect(await repository.claimAttempt(expired.id)).toBeNull();

    await ageSends();
    const verified = request();
    await repository.issue(verified);
    expect(await repository.markVerified(verified.id)).toBe(true);
    expect(await repository.claimAttempt(verified.id)).toBeNull();
  });

  it("verifies on the fifth attempt, since the attempt was already counted", async () => {
    const issued = request();
    await repository.issue(issued);
    for (let i = 1; i <= 5; i++) await repository.claimAttempt(issued.id);
    expect(await repository.markVerified(issued.id)).toBe(true);
  });

  it("does not verify an expired code", async () => {
    const issued = request();
    await repository.issue(issued);
    await db.update(emailVerifications).set({ expiresAt: sql`now() - interval '1 second'` }).where(eq(emailVerifications.id, issued.id));
    expect((await repository.findLatest({ seatHoldId: holdId, email: EMAIL }))!.expired).toBe(true);
    expect(await repository.markVerified(issued.id)).toBe(false);
  });

  it("consumes a verified proof exactly once, and never an unverified one", async () => {
    const issued = request();
    await repository.issue(issued);
    expect(await consumeVerifiedEmail(db, { seatHoldId: holdId, email: EMAIL })).toBe(false);

    expect(await repository.markVerified(issued.id)).toBe(true);
    expect(await consumeVerifiedEmail(db, { seatHoldId: holdId, email: "otra@gmail.com" })).toBe(false);
    expect(await consumeVerifiedEmail(db, { seatHoldId: holdId, email: EMAIL })).toBe(true);
    expect(await consumeVerifiedEmail(db, { seatHoldId: holdId, email: EMAIL })).toBe(false);
  });
});
