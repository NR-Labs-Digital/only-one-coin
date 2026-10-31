import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

/**
 * The database side of two rules that until migration 0011 lived only in the
 * application: `audit_log` is append-only (CLAUDE.md §8) and physical delete
 * does not exist for the records that carry history or legal proof
 * (CLAUDE.md §6, packages/db/CLAUDE.md "Sem grant de DELETE").
 *
 * An interface can only refuse what goes through it. Whoever reaches Postgres
 * with a connection string — a leaked credential, a psql session, a query
 * console — was refused by nothing. So the statements below are issued
 * straight at the database, with no repository and no usecase in the way, and
 * every one of them is expected to be rejected.
 *
 * Two layers are checked separately because they fail for different reasons
 * and cover different attackers:
 *
 *   - GRANT: the application role (`ooc_app`) has no DELETE on the locked
 *     tables and no UPDATE on `audit_log`, so Postgres refuses with 42501
 *     before a single row is read. This is what a compromised `apps/api`
 *     runs into.
 *   - TRIGGER: the tables' own owner — who can re-grant itself anything, and
 *     is a superuser in compose.yml — is stopped by a statement-level trigger
 *     instead. This is what a leaked DATABASE_URL runs into, and it is the
 *     realistic leak today, since the same string still migrates the schema.
 *
 * Needs a real, migrated Postgres: `pnpm db:up && pnpm db:migrate`.
 */

const { Client } = pg;

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is required: this suite issues the forbidden statements against a real, migrated Postgres.",
  );
}

/** The role `apps/api` connects as — never the owner of the tables. */
const APP_ROLE = "ooc_app";

/** Postgres `insufficient_privilege` — the GRANT layer answering. */
const DENIED_BY_GRANT = "42501";

/** SQLSTATE raised by `forbid_physical_delete()` — the TRIGGER layer answering. */
const DENIED_BY_TRIGGER = "OOC01";

/**
 * Tables where a row may never physically leave. `students` has `deleted_at`
 * to take its place, and so does `teachers` (a teacher leaves the staff, the
 * record stays); the others are append-only by nature — money, receipt
 * readings kept with the payment (first reading and every re-read), Ley 29733
 * consent, audit trail (CLAUDE.md §1/§6).
 */
const DELETE_LOCKED = [
  "students",
  "payments",
  "payment_receipts",
  "receipt_rereads",
  "consents",
  "audit_log",
  "teachers",
] as const;

/**
 * Matches no row anywhere: every statement here must be turned away before it
 * can reach data, so the suite proves the lock without depending on fixtures —
 * and could not destroy anything even if the lock were missing.
 */
const NO_SUCH_ID = "00000000-0000-7000-8000-000000000000";

let db: pg.Client;

beforeAll(async () => {
  db = new Client({ connectionString: DATABASE_URL });
  await db.connect();
});

afterAll(async () => {
  await db.end();
});

// Every test runs inside a transaction that is always rolled back: the
// statements that are supposed to be allowed (the positive controls) do write,
// and this suite runs against a database someone else owns.
beforeEach(async () => {
  await db.query("begin");
});

afterEach(async () => {
  await db.query("rollback");
});

/**
 * Runs `statement` and reports how Postgres answered: the SQLSTATE when it
 * refused, or `"SUCCEEDED"` when it did not refuse at all — which is itself
 * the failure this suite is looking for.
 */
async function answerTo(statement: string): Promise<string> {
  try {
    await db.query(statement);
    return "SUCCEEDED";
  } catch (error) {
    return (error as { code?: string }).code ?? "UNKNOWN";
  }
}

/** Table names come from the literal tuples above, never from input. */
const deleteFrom = (table: string) => `delete from ${table} where id = '${NO_SUCH_ID}'`;

describe("application role (GRANT layer)", () => {
  beforeEach(async () => {
    // `local` so the role reverts with the transaction, aborted or not.
    await db.query(`set local role ${APP_ROLE}`);
  });

  it.each(DELETE_LOCKED)("refuses DELETE on %s", async (table) => {
    expect(await answerTo(deleteFrom(table))).toBe(DENIED_BY_GRANT);
  });

  it("refuses UPDATE on audit_log", async () => {
    expect(await answerTo(`update audit_log set action = 'tampered' where id = '${NO_SUCH_ID}'`)).toBe(
      DENIED_BY_GRANT,
    );
  });

  // Price is versioned, never edited (apps/api/CLAUDE.md): plan_prices only
  // receives INSERT.
  it("refuses UPDATE on plan_prices", async () => {
    expect(
      await answerTo(`update plan_prices set amount_cents = amount_cents where id = '${NO_SUCH_ID}'`),
    ).toBe(DENIED_BY_GRANT);
  });

  it("refuses DELETE on plan_prices", async () => {
    expect(await answerTo(deleteFrom("plan_prices"))).toBe(DENIED_BY_GRANT);
  });

  it("refuses TRUNCATE on audit_log", async () => {
    expect(await answerTo("truncate audit_log")).toBe(DENIED_BY_GRANT);
  });

  // The lock has to be surgical: a role that lost more than the four
  // statements above would break the platform instead of protecting it.
  it("refuses UPDATE on outbox_delivery_events", async () => {
    expect(
      await answerTo(`update outbox_delivery_events set kind = 'delivered' where id = '${NO_SUCH_ID}'`),
    ).toBe(DENIED_BY_TRIGGER);
  });

  it("refuses DELETE on outbox_delivery_events", async () => {
    expect(await answerTo(deleteFrom("outbox_delivery_events"))).toBe(DENIED_BY_TRIGGER);
  });

  // No inbound foreign key, so the trigger — not Postgres' FK rule — refuses.
  it("blocks TRUNCATE on outbox_delivery_events", async () => {
    expect(await answerTo("truncate outbox_delivery_events")).toBe(DENIED_BY_TRIGGER);
  });

  it("still appends to audit_log", async () => {
    expect(
      await answerTo(
        "insert into audit_log (actor_id, action, target_id) values ('usr_test', 'test.append', 'tgt_test')",
      ),
    ).toBe("SUCCEEDED");
  });

  it("still soft-deletes a student", async () => {
    expect(await answerTo(`update students set deleted_at = now() where id = '${NO_SUCH_ID}'`)).toBe(
      "SUCCEEDED",
    );
  });

  it("still reads the locked tables", async () => {
    expect(await answerTo("select count(*) from audit_log")).toBe("SUCCEEDED");
  });

  it("still DELETEs from a table outside the lock", async () => {
    expect(await answerTo(deleteFrom("waitlist_entries"))).toBe("SUCCEEDED");
  });

  // A filed contract is documentary proof: correcting it is filing a new one.
  it("refuses UPDATE on teacher_contracts", async () => {
    expect(
      await answerTo(`update teacher_contracts set file_name = 'tampered' where id = '${NO_SUCH_ID}'`),
    ).toBe(DENIED_BY_GRANT);
  });

  it("refuses DELETE on teacher_contracts", async () => {
    expect(await answerTo(deleteFrom("teacher_contracts"))).toBe(DENIED_BY_GRANT);
  });

  // A published template version is what documents were issued from (OOC-123).
  it("refuses UPDATE on document_template_versions", async () => {
    expect(
      await answerTo(`update document_template_versions set body = 'tampered' where id = '${NO_SUCH_ID}'`),
    ).toBe(DENIED_BY_GRANT);
  });

  it("refuses DELETE on document_template_versions", async () => {
    expect(await answerTo(deleteFrom("document_template_versions"))).toBe(DENIED_BY_GRANT);
  });

  // The provider's account of a message (OOC-91) is a history, not a status.
  it("refuses UPDATE on outbox_delivery_events", async () => {
    expect(
      await answerTo(`update outbox_delivery_events set kind = 'delivered' where id = '${NO_SUCH_ID}'`),
    ).toBe(DENIED_BY_GRANT);
  });

  it("refuses DELETE on outbox_delivery_events", async () => {
    expect(await answerTo(deleteFrom("outbox_delivery_events"))).toBe(DENIED_BY_GRANT);
  });

  it("still rewrites a document template draft", async () => {
    expect(
      await answerTo(`update document_template_drafts set body = body where id = '${NO_SUCH_ID}'`),
    ).toBe("SUCCEEDED");
  });

  it("still moves a teacher out of the roster", async () => {
    expect(await answerTo(`update teachers set status = 'inactive' where id = '${NO_SUCH_ID}'`)).toBe("SUCCEEDED");
  });
});

describe("table owner (TRIGGER layer)", () => {
  it.each(DELETE_LOCKED)("blocks DELETE on %s", async (table) => {
    expect(await answerTo(deleteFrom(table))).toBe(DENIED_BY_TRIGGER);
  });

  it("blocks UPDATE on audit_log", async () => {
    expect(await answerTo(`update audit_log set action = 'tampered' where id = '${NO_SUCH_ID}'`)).toBe(
      DENIED_BY_TRIGGER,
    );
  });

  // Price is versioned, never edited (apps/api/CLAUDE.md): plan_prices only
  // receives INSERT.
  it("refuses UPDATE on plan_prices", async () => {
    expect(
      await answerTo(`update plan_prices set amount_cents = amount_cents where id = '${NO_SUCH_ID}'`),
    ).toBe(DENIED_BY_TRIGGER);
  });

  it("refuses DELETE on plan_prices", async () => {
    expect(await answerTo(deleteFrom("plan_prices"))).toBe(DENIED_BY_TRIGGER);
  });

  // TRUNCATE is checked on `audit_log` alone: among the tables locked here it
  // is the one with no inbound foreign key (`teacher_contracts` has none too,
  // but it is covered by its own suite), so the trigger — and not Postgres' own
  // "cannot truncate a table referenced in a foreign key constraint" — is what
  // does the refusing.
  it("blocks TRUNCATE on audit_log", async () => {
    expect(await answerTo("truncate audit_log")).toBe(DENIED_BY_TRIGGER);
  });

  it("refuses UPDATE on teacher_contracts", async () => {
    expect(
      await answerTo(`update teacher_contracts set file_name = 'tampered' where id = '${NO_SUCH_ID}'`),
    ).toBe(DENIED_BY_TRIGGER);
  });

  it("refuses DELETE on teacher_contracts", async () => {
    expect(await answerTo(deleteFrom("teacher_contracts"))).toBe(DENIED_BY_TRIGGER);
  });

  // No inbound foreign key, so the trigger — not Postgres' FK rule — refuses.
  it("blocks TRUNCATE on teacher_contracts", async () => {
    expect(await answerTo("truncate teacher_contracts")).toBe(DENIED_BY_TRIGGER);
  });

  it("refuses UPDATE on document_template_versions", async () => {
    expect(
      await answerTo(`update document_template_versions set body = 'tampered' where id = '${NO_SUCH_ID}'`),
    ).toBe(DENIED_BY_TRIGGER);
  });

  it("refuses DELETE on document_template_versions", async () => {
    expect(await answerTo(deleteFrom("document_template_versions"))).toBe(DENIED_BY_TRIGGER);
  });

  // `teacher_contracts` points here since 0036, so a plain TRUNCATE is refused
  // by Postgres' FK rule first. CASCADE gets past that rule — and the trigger
  // still refuses, which is the layer this suite is proving.
  it("blocks TRUNCATE on document_template_versions, even with CASCADE", async () => {
    expect(await answerTo("truncate document_template_versions cascade")).toBe(DENIED_BY_TRIGGER);
  });

  it("still appends to audit_log", async () => {
    expect(
      await answerTo(
        "insert into audit_log (actor_id, action, target_id) values ('usr_test', 'test.append', 'tgt_test')",
      ),
    ).toBe("SUCCEEDED");
  });

  it("still soft-deletes a student", async () => {
    expect(await answerTo(`update students set deleted_at = now() where id = '${NO_SUCH_ID}'`)).toBe(
      "SUCCEEDED",
    );
  });
});
