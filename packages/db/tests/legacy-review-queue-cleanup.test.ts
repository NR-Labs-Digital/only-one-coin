import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

/**
 * Migration 0068 (OOC-184), run again inside a rolled-back transaction over
 * rows built here: it settles only the legacy import's open payments, and
 * nothing the checkout or the panel created.
 *
 * Needs a real, migrated Postgres: `pnpm db:up && pnpm db:migrate`.
 */

const { Client } = pg;
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is required: this suite runs migration 0068 against a real, migrated Postgres.");
}

const MIGRATION = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "../migrations/0068_legacy_review_queue_cleanup.sql"),
  "utf8",
);

let db: pg.Client;
let classGroupId: string;
let planPriceId: string;
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
  const { rows } = await db.query<{ class_group_id: string; plan_price_id: string }>(
    `with period as (
       insert into academic_periods (name, starts_on, ends_on) values ('P', '2026-08-01', '2026-09-30') returning id
     ), course as (
       insert into courses (name, language, min_age) values ('C', 'en', 12) returning id
     ), plan as (
       insert into plans (course_id, name) select id, 'Paquete' from course returning id
     ), price as (
       insert into plan_prices (plan_id, amount_cents) select id, 15000 from plan returning id
     ), class_group as (
       insert into class_groups (course_id, academic_period_id, capacity, schedule, starts_on, ends_on)
       select course.id, period.id, 30, 'Lun 19:00', '2026-08-24', '2026-09-23' from course, period returning id
     )
     select class_group.id as class_group_id, price.id as plan_price_id from class_group, price`,
  );
  classGroupId = rows[0]!.class_group_id;
  planPriceId = rows[0]!.plan_price_id;
});

afterEach(async () => {
  await db.query("rollback");
});

/** One student, one enrollment, one payment; returns the payment id. */
async function payment(params: {
  key: string;
  status: "pending" | "under_review" | "approved" | "rejected";
  seat: "reserved" | "confirmed" | "released";
}): Promise<string> {
  sequence++;
  const decided = params.status === "approved" || params.status === "rejected";
  const { rows } = await db.query<{ id: string }>(
    `with student as (
       insert into students (first_name, last_name, national_id_type, national_id, email, phone, birth_date, country, city)
       values ('Ana', 'Quispe', 'DNI', $1, $2, '+51900000000', '2000-01-01', 'PE', 'Lima') returning id
     ), enrollment as (
       insert into enrollments (student_id, class_group_id, plan_price_id, seat_status)
       select student.id, $3, $4, $5 from student returning id
     )
     insert into payments (enrollment_id, idempotency_key, status, method, amount_cents, decided_at)
     select enrollment.id, $6, $7, 'yape', 15000, $8 from enrollment
     returning id`,
    [
      `OOC184${sequence}`,
      `ooc184.${sequence}@gmail.com`,
      classGroupId,
      planPriceId,
      params.seat,
      params.key,
      params.status,
      decided ? new Date() : null,
    ],
  );
  return rows[0]!.id;
}

async function stateOf(paymentId: string) {
  const { rows } = await db.query<{
    status: string;
    decided_at: Date | null;
    decided_by: string | null;
    rejection_reason: string | null;
    seat_status: string;
  }>(
    `select p.status, p.decided_at, p.decided_by, p.rejection_reason, e.seat_status
     from payments p join enrollments e on e.id = p.enrollment_id where p.id = $1`,
    [paymentId],
  );
  return rows[0]!;
}

describe("migration 0068: legacy review queue cleanup (OOC-184)", () => {
  it("rejects every open legacy payment and releases its seat, with no reviewer and no reason", async () => {
    const underReview = await payment({ key: "legacy:A.xlsx:S:2", status: "under_review", seat: "reserved" });
    const pending = await payment({ key: "legacy:A.xlsx:S:3", status: "pending", seat: "reserved" });

    await db.query(MIGRATION);

    for (const id of [underReview, pending]) {
      const state = await stateOf(id);
      expect(state.status).toBe("rejected");
      expect(state.decided_at).not.toBeNull();
      expect(state.decided_by).toBeNull();
      expect(state.rejection_reason).toBeNull();
      expect(state.seat_status).toBe("released");
    }
  });

  it("leaves legacy payments that were already settled as they are", async () => {
    const approved = await payment({ key: "legacy:A.xlsx:S:4", status: "approved", seat: "confirmed" });

    await db.query(MIGRATION);

    expect(await stateOf(approved)).toMatchObject({ status: "approved", seat_status: "confirmed" });
  });

  it("never touches a payment the checkout or the panel created", async () => {
    const checkout = await payment({ key: "checkout:9f1c", status: "under_review", seat: "reserved" });
    const panel = await payment({ key: "manual:legacy:looking", status: "pending", seat: "reserved" });

    await db.query(MIGRATION);

    expect(await stateOf(checkout)).toMatchObject({ status: "under_review", decided_at: null, seat_status: "reserved" });
    expect(await stateOf(panel)).toMatchObject({ status: "pending", decided_at: null, seat_status: "reserved" });
  });
});
