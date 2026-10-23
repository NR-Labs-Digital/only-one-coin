import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

/**
 * A `teacher` invite names the teacher file it opens an account for (OOC-79),
 * asked of Postgres directly: only a teacher invite carries a file, a pending
 * one must, and one file has at most one invite open.
 *
 * Every test runs in a transaction that is always rolled back.
 * Needs a real, migrated Postgres: `pnpm db:up && pnpm db:migrate`.
 */

const { Client } = pg;
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is required: this suite checks staff_invites against a real, migrated Postgres.");
}

const CHECK_VIOLATION = "23514";
const UNIQUE_VIOLATION = "23505";
const FOREIGN_KEY_VIOLATION = "23503";

let db: pg.Client;

beforeAll(async () => {
  db = new Client({ connectionString: DATABASE_URL });
  await db.connect();
});

afterAll(async () => {
  await db.end();
});

beforeEach(async () => {
  await db.query("begin");
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

async function insertTeacher(nationalId: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into teachers (first_name, last_name, national_id_type, national_id, email, phone,
                           nationality, country, region, city, address_line)
     values ('Ana', 'Quispe', 'DNI', $1, 'ana@example.com', '+51900000000', 'PE', 'PE', 'Lima', 'Lima', 'Av. Siempre Viva 123')
     returning id`,
    [nationalId],
  );
  return rows[0]!.id;
}

let tokens = 0;

function invite(params: { email: string; role: string; teacherId: string | null; status?: string }): Promise<string> {
  tokens += 1;
  return answerTo(
    `insert into staff_invites (email, first_name, last_name, role, token, status, invited_by, teacher_id, expires_at)
     values ($1, 'Ana', 'Quispe', $2, $3, $4, 'usr_admin', $5, now() + interval '7 days')`,
    [params.email, params.role, `tok_ooc79_${tokens}`, params.status ?? "pending", params.teacherId],
  );
}

describe("staff_invites.teacher_id", () => {
  it("opens a teacher invite for a teacher file", async () => {
    const teacher = await insertTeacher("70000101");
    expect(await invite({ email: "ana@example.com", role: "teacher", teacherId: teacher })).toBe("SUCCEEDED");
  });

  it("refuses a pending teacher invite without a file", async () => {
    expect(await invite({ email: "ana@example.com", role: "teacher", teacherId: null })).toBe(CHECK_VIOLATION);
  });

  it("refuses a file on an invite for another role", async () => {
    const teacher = await insertTeacher("70000102");
    expect(await invite({ email: "ana@example.com", role: "support", teacherId: teacher })).toBe(CHECK_VIOLATION);
  });

  it("keeps a teacher invite from before the link, once it is no longer pending", async () => {
    expect(await invite({ email: "old@example.com", role: "teacher", teacherId: null, status: "cancelled" })).toBe(
      "SUCCEEDED",
    );
  });

  it("refuses a second open invite for the same file", async () => {
    const teacher = await insertTeacher("70000103");
    await invite({ email: "ana@example.com", role: "teacher", teacherId: teacher });
    expect(await invite({ email: "ana2@example.com", role: "teacher", teacherId: teacher })).toBe(UNIQUE_VIOLATION);
  });

  it("opens a new invite for the file once the last one is closed", async () => {
    const teacher = await insertTeacher("70000104");
    await invite({ email: "ana@example.com", role: "teacher", teacherId: teacher, status: "cancelled" });
    expect(await invite({ email: "ana@example.com", role: "teacher", teacherId: teacher })).toBe("SUCCEEDED");
  });

  it("points at a real file", async () => {
    expect(
      await invite({ email: "ana@example.com", role: "teacher", teacherId: "00000000-0000-7000-8000-000000000000" }),
    ).toBe(FOREIGN_KEY_VIOLATION);
  });
});
