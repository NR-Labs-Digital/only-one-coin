import * as schema from "@ooc/db";
import { outbox } from "@ooc/db";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/infra/db/client.js";
import { EmailFlowCountsQuery, type EmailFlowCounts } from "./EmailFlowCountsQuery.js";

/**
 * The e-mail screens' counts (OOC-88) against Postgres: per template and
 * status, over the window, `pending` left out.
 *
 * The counts are global, so rows already in the database count too. The test
 * reads a baseline inside a transaction that is always rolled back and
 * asserts the difference — never an absolute count.
 */

const { Pool } = pg;
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is required: this suite exercises the e-mail counts SQL against a real, migrated Postgres.");
}

const NOW = new Date("2031-01-31T15:00:00.000Z");
const INSIDE = new Date("2031-01-20T15:00:00.000Z");
const BEFORE_WINDOW = new Date("2030-12-20T15:00:00.000Z");
const AFTER_NOW = new Date("2031-02-02T15:00:00.000Z");

class RolledBack extends Error {}

let pool: pg.Pool;
let db: Db;

beforeAll(() => {
  pool = new Pool({ connectionString: DATABASE_URL, max: 2 });
  db = drizzle(pool, { schema, casing: "snake_case" });
});

afterAll(async () => {
  await pool.end();
});

let sequence = 0;

function row(templateKey: string, status: string, createdAt: Date) {
  sequence += 1;
  return {
    templateKey,
    recipient: "counts@example.com",
    locale: "es-PE",
    vars: {},
    dedupeKey: `email-flow-counts:${Date.now()}:${sequence}`,
    status,
    createdAt,
    updatedAt: createdAt,
  };
}

function minus(after: EmailFlowCounts, before: EmailFlowCounts): EmailFlowCounts {
  return { sent: after.sent - before.sent, failed: after.failed - before.failed, blocked: after.blocked - before.blocked };
}

describe("EmailFlowCountsQuery", () => {
  it("counts each template's sent, failed and blocked rows inside the window only", async () => {
    let approved: EmailFlowCounts | undefined;
    let rejected: EmailFlowCounts | undefined;
    let unknownKeyLeaked = false;

    try {
      await db.transaction(async (tx) => {
        const query = new EmailFlowCountsQuery(tx as unknown as Db);
        const before = await query.run(NOW);

        await tx.insert(outbox).values([
          row("payment_approved", "sent", INSIDE),
          row("payment_approved", "sent", INSIDE),
          row("payment_approved", "failed", INSIDE),
          row("payment_approved", "blocked", INSIDE),
          row("payment_approved", "pending", INSIDE),
          row("payment_approved", "sent", BEFORE_WINDOW),
          row("payment_approved", "sent", AFTER_NOW),
          row("payment_rejected", "failed", INSIDE),
          row("retired_template", "sent", INSIDE),
        ]);

        const after = await query.run(NOW);
        approved = minus(after.payment_approved, before.payment_approved);
        rejected = minus(after.payment_rejected, before.payment_rejected);
        unknownKeyLeaked = "retired_template" in after;
        throw new RolledBack();
      });
    } catch (error) {
      if (!(error instanceof RolledBack)) throw error;
    }

    expect(approved).toEqual({ sent: 2, failed: 1, blocked: 1 });
    expect(rejected).toEqual({ sent: 0, failed: 1, blocked: 0 });
    expect(unknownKeyLeaked).toBe(false);
  });
});
