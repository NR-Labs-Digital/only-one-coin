import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

/**
 * The payment decision's own columns (OOC-112), asked of Postgres directly: a
 * decided payment always says when, only a rejection carries a reason, and the
 * reviewer has to be an account.
 *
 * Every test runs in a transaction that is always rolled back.
 * Needs a real, migrated Postgres: `pnpm db:up && pnpm db:migrate`.
 */

const { Client } = pg;
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is required: this suite checks the payment decision against a real, migrated Postgres.");
}

const CHECK_VIOLATION = "23514";
const FOREIGN_KEY_VIOLATION = "23503";

const USER_ID = "usr_ooc112_test";

let db: pg.Client;
let enrollmentId: string;
let sequence = 0;

beforeAll(async () => {
  db = new Client({ connectionString: DATABASE_URL });
  await db.connect();
});

afterAll(async () => {
  await db.end();
});

beforeEach(async () => {
  await db.query("begin");
  await db.query(
    `insert into "user" (id, name, email, "emailVerified", role) values ($1, 'Caja', 'ooc112@example.com', true, 'billing')`,
    [USER_ID],
  );
  const { rows } = await db.query<{ id: string }>(
    `with period as (
       insert into academic_periods (name, starts_on, ends_on) values ('P', '2026-03-01', '2026-07-31') returning id
     ), course as (
       insert into courses (name, language, min_age) values ('C', 'en', 12) returning id
     ), plan as (
       insert into plans (course_id, name) select id, 'Paquete' from course returning id
     ), price as (
       insert into plan_prices (plan_id, amount_cents) select id, 15000 from plan returning id
     ), class_group as (
       insert into class_groups (course_id, academic_period_id, capacity, schedule, starts_on, ends_on)
       select course.id, period.id, 30, 'Lun 19:00', '2026-03-02', '2026-06-30' from course, period returning id
     ), student as (
       insert into students (first_name, last_name, national_id_type, national_id, email, phone, birth_date, country, city)
       values ('Ana', 'Quispe', 'DNI', 'OOC112', 'ooc112@gmail.com', '+51900000000', '2000-01-01', 'PE', 'Lima') returning id
     )
     insert into enrollments (student_id, class_group_id, plan_price_id)
     select student.id, class_group.id, price.id from student, class_group, price
     returning id`,
  );
  enrollmentId = rows[0]!.id;
});

afterEach(async () => {
  await db.query("rollback");
});

/** The SQLSTATE Postgres answered with, or "SUCCEEDED". */
async function answerTo(statement: string, params: unknown[] = []): Promise<string> {
  await db.query("savepoint attempt");
  try {
    await db.query(statement, params);
    await db.query("release savepoint attempt");
    return "SUCCEEDED";
  } catch (error) {
    await db.query("rollback to savepoint attempt");
    return (error as { code?: string }).code ?? "UNKNOWN";
  }
}

function insertPayment(columns: {
  status: string;
  decidedAt?: string | null;
  decidedBy?: string | null;
  rejectionReason?: string | null;
}): Promise<string> {
  sequence += 1;
  return answerTo(
    `insert into payments (enrollment_id, idempotency_key, status, method, amount_cents, decided_at, decided_by, rejection_reason)
     values ($1, $2, $3, 'yape', 15000, $4, $5, $6)`,
    [
      enrollmentId,
      `ooc112-${sequence}`,
      columns.status,
      columns.decidedAt ?? null,
      columns.decidedBy ?? null,
      columns.rejectionReason ?? null,
    ],
  );
}

describe("payments decision", () => {
  it("an open payment has no decision", async () => {
    expect(await insertPayment({ status: "pending" })).toBe("SUCCEEDED");
    expect(await insertPayment({ status: "under_review", decidedAt: "2026-03-10T15:00:00Z" })).toBe(CHECK_VIOLATION);
  });

  it("a decided payment always says when", async () => {
    expect(await insertPayment({ status: "approved" })).toBe(CHECK_VIOLATION);
    expect(await insertPayment({ status: "rejected" })).toBe(CHECK_VIOLATION);
    expect(await insertPayment({ status: "approved", decidedAt: "2026-03-10T15:00:00Z", decidedBy: USER_ID })).toBe("SUCCEEDED");
  });

  it("names nobody without a date, and only an account", async () => {
    expect(await insertPayment({ status: "pending", decidedBy: USER_ID })).toBe(CHECK_VIOLATION);
    expect(await insertPayment({ status: "approved", decidedAt: "2026-03-10T15:00:00Z", decidedBy: "usr_nobody" })).toBe(
      FOREIGN_KEY_VIOLATION,
    );
  });

  it("only a rejection carries a reason, and only a known one", async () => {
    expect(
      await insertPayment({ status: "rejected", decidedAt: "2026-03-10T15:00:00Z", rejectionReason: "illegible" }),
    ).toBe("SUCCEEDED");
    // The legacy import's rejections have none to give.
    expect(await insertPayment({ status: "rejected", decidedAt: "2026-03-10T15:00:00Z" })).toBe("SUCCEEDED");
    expect(
      await insertPayment({ status: "approved", decidedAt: "2026-03-10T15:00:00Z", rejectionReason: "illegible" }),
    ).toBe(CHECK_VIOLATION);
    expect(
      await insertPayment({ status: "rejected", decidedAt: "2026-03-10T15:00:00Z", rejectionReason: "made_up" }),
    ).toBe(CHECK_VIOLATION);
  });
});
