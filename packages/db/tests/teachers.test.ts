import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

/**
 * The teacher tables' own rules (OOC-77), asked of Postgres directly: a
 * contract is filed whole or not at all, a document names one living teacher,
 * an availability window runs forwards, and nothing here cascades.
 *
 * Every test runs in a transaction that is always rolled back.
 * Needs a real, migrated Postgres: `pnpm db:up && pnpm db:migrate`.
 */

const { Client } = pg;
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is required: this suite checks the teacher tables against a real, migrated Postgres.");
}

const CHECK_VIOLATION = "23514";
const NOT_NULL_VIOLATION = "23502";
const UNIQUE_VIOLATION = "23505";

const USER_ID = "usr_ooc77_test";

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
  await db.query(
    `insert into "user" (id, name, email, "emailVerified", role) values ($1, 'Staff', 'ooc77@example.com', true, 'admin')`,
    [USER_ID],
  );
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

async function insertTemplateVersion(version: number): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into document_template_versions (kind, version, body, published_by)
     values ('teacher_contract', $1, '<p>v</p>', $2)
     returning id`,
    [version, USER_ID],
  );
  return rows[0]!.id;
}

const CONTRACT_COLUMNS = "teacher_id, object_key, file_name, file_size_bytes, starts_on, ends_on, uploaded_by";

describe("teacher_contracts", () => {
  it("files a whole contract", async () => {
    const teacher = await insertTeacher("70000001");
    expect(
      await answerTo(
        `insert into teacher_contracts (${CONTRACT_COLUMNS})
         values ($1, 'contracts/t/1.pdf', 'contrato.pdf', 1024, '2026-03-01', '2026-12-31', $2)`,
        [teacher, USER_ID],
      ),
    ).toBe("SUCCEEDED");
  });

  it("records a generated contract: the period and a template version, no file (OOC-124)", async () => {
    const teacher = await insertTeacher("70000005");
    const version = await insertTemplateVersion(1);
    expect(
      await answerTo(
        `insert into teacher_contracts (teacher_id, template_version_id, starts_on, ends_on, uploaded_by)
         values ($1, $2, '2026-03-01', '2026-12-31', $3)`,
        [teacher, version, USER_ID],
      ),
    ).toBe("SUCCEEDED");
  });

  it("refuses a contract with neither a file nor a template version", async () => {
    const teacher = await insertTeacher("70000006");
    expect(
      await answerTo(
        `insert into teacher_contracts (teacher_id, starts_on, ends_on, uploaded_by)
         values ($1, '2026-03-01', '2026-12-31', $2)`,
        [teacher, USER_ID],
      ),
    ).toBe(CHECK_VIOLATION);
  });

  it.each([
    ["no key", "null, 'contrato.pdf', 1024"],
    ["no name", "'contracts/t/6.pdf', null, 1024"],
    ["no size", "'contracts/t/7.pdf', 'contrato.pdf', null"],
  ])("refuses half a file (%s), even with a template version", async (_missing, file) => {
    const teacher = await insertTeacher("70000007");
    const version = await insertTemplateVersion(2);
    expect(
      await answerTo(
        `insert into teacher_contracts (${CONTRACT_COLUMNS}, template_version_id)
         values ($1, ${file}, '2026-03-01', '2026-12-31', $2, $3)`,
        [teacher, USER_ID, version],
      ),
    ).toBe(CHECK_VIOLATION);
  });

  it.each([
    ["the start", "'contracts/t/2.pdf', 'contrato.pdf', 1024, null, '2026-12-31'"],
    ["the end", "'contracts/t/3.pdf', 'contrato.pdf', 1024, '2026-03-01', null"],
  ])("refuses a contract without %s", async (_missing, values) => {
    const teacher = await insertTeacher("70000002");
    expect(
      await answerTo(`insert into teacher_contracts (${CONTRACT_COLUMNS}) values ($1, ${values}, $2)`, [
        teacher,
        USER_ID,
      ]),
    ).toBe(NOT_NULL_VIOLATION);
  });

  it("refuses a contract that ends before it starts", async () => {
    const teacher = await insertTeacher("70000003");
    expect(
      await answerTo(
        `insert into teacher_contracts (${CONTRACT_COLUMNS})
         values ($1, 'contracts/t/4.pdf', 'contrato.pdf', 1024, '2026-12-31', '2026-03-01', $2)`,
        [teacher, USER_ID],
      ),
    ).toBe(CHECK_VIOLATION);
  });

  it("refuses an empty file", async () => {
    const teacher = await insertTeacher("70000004");
    expect(
      await answerTo(
        `insert into teacher_contracts (${CONTRACT_COLUMNS})
         values ($1, 'contracts/t/5.pdf', 'contrato.pdf', 0, '2026-03-01', '2026-12-31', $2)`,
        [teacher, USER_ID],
      ),
    ).toBe(CHECK_VIOLATION);
  });
});

describe("teachers", () => {
  it("refuses a document that is not stored normalized", async () => {
    expect(
      await answerTo(
        `insert into teachers (first_name, last_name, national_id_type, national_id, email, phone,
                               nationality, country, region, city, address_line)
         values ('Ana', 'Quispe', 'DNI', '12.345.678', 'ana@example.com', '+51900000000', 'PE', 'PE', 'Lima', 'Lima', 'Av. Siempre Viva 123')`,
      ),
    ).toBe(CHECK_VIOLATION);
  });

  it("refuses a second living teacher with the same document", async () => {
    await insertTeacher("70000010");
    await expect(insertTeacher("70000010")).rejects.toMatchObject({ code: UNIQUE_VIOLATION });
  });

  it("lets a retired teacher's document be used again", async () => {
    const first = await insertTeacher("70000011");
    await db.query("update teachers set deleted_at = now() where id = $1", [first]);
    await expect(insertTeacher("70000011")).resolves.toBeTypeOf("string");
  });

  it("refuses a status outside the roster's two", async () => {
    const teacher = await insertTeacher("70000012");
    expect(await answerTo("update teachers set status = 'retired' where id = $1", [teacher])).toBe(CHECK_VIOLATION);
  });
});

describe("teacher_availability", () => {
  it("refuses a window with seconds in it", async () => {
    const teacher = await insertTeacher("70000022");
    expect(
      await answerTo(
        "insert into teacher_availability (teacher_id, weekday, start_time, end_time) values ($1, 'tue', '19:00:30', '21:00')",
        [teacher],
      ),
    ).toBe(CHECK_VIOLATION);
  });

  it("refuses a window that does not run forwards", async () => {
    const teacher = await insertTeacher("70000020");
    expect(
      await answerTo(
        "insert into teacher_availability (teacher_id, weekday, start_time, end_time) values ($1, 'tue', '19:00', '19:00')",
        [teacher],
      ),
    ).toBe(CHECK_VIOLATION);
  });

  it("refuses a weekday it does not know", async () => {
    const teacher = await insertTeacher("70000021");
    expect(
      await answerTo(
        "insert into teacher_availability (teacher_id, weekday, start_time, end_time) values ($1, 'tuesday', '19:00', '21:00')",
        [teacher],
      ),
    ).toBe(CHECK_VIOLATION);
  });
});

describe("foreign keys", () => {
  it("never cascade a delete into a teacher's history", async () => {
    const { rows } = await db.query<{ constraint_name: string; delete_rule: string }>(
      `select rc.constraint_name, rc.delete_rule
         from information_schema.referential_constraints rc
         join information_schema.table_constraints tc on tc.constraint_name = rc.constraint_name
        where tc.table_schema = 'public'
          and (tc.table_name like 'teacher%' or rc.constraint_name = 'class_groups_teacher_id_teachers_id_fk')
        order by rc.constraint_name`,
    );

    expect(rows.map((row) => row.constraint_name)).toEqual([
      "class_groups_teacher_id_teachers_id_fk",
      "teacher_availability_teacher_id_teachers_id_fk",
      "teacher_contracts_teacher_id_teachers_id_fk",
      "teacher_contracts_template_version_id_fk",
      "teacher_contracts_uploaded_by_user_id_fk",
      "teacher_languages_language_id_languages_id_fk",
      "teacher_languages_teacher_id_teachers_id_fk",
      "teachers_user_id_user_id_fk",
    ]);
    for (const row of rows) expect(row.delete_rule, row.constraint_name).toBe("RESTRICT");
  });
});
