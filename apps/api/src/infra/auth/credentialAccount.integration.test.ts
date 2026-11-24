import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@ooc/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Config } from "@/config.js";
import type { Db } from "@/infra/db/client.js";
import { ConflictError } from "@ooc/domain";
import { BetterAuthStaffAccountProvisioner } from "@/infra/identity/BetterAuthStaffAccountProvisioner.js";
import { createAuth, type Auth } from "./betterAuth.js";
import { insertCredentialUser, insertPasswordlessUser, upsertCredentialPassword } from "./credentialAccount.js";

/**
 * The accounts apps/api writes without Better Auth's sign-up (closed —
 * `disableSignUp`), proven by signing in through Better Auth itself. Better
 * Auth reads through its own pool, so these rows are committed; "user" is not
 * under the delete lock (0011), and afterAll removes them (account and session
 * cascade).
 */

const { Pool } = pg;
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("DATABASE_URL is required for this suite.");

const RUN = Date.now().toString(36);
const created: string[] = [];
let pool: pg.Pool;
let db: Db;
let auth: Auth;

beforeAll(() => {
  pool = new Pool({ connectionString: DATABASE_URL, max: 2 });
  db = drizzle(pool, { schema, casing: "snake_case" });
  auth = createAuth({
    NODE_ENV: "test",
    PORT: 3333,
    DATABASE_URL,
    BETTER_AUTH_URL: "http://localhost:3333/api/auth",
    BETTER_AUTH_SECRET: "integration-secret-at-least-32-characters",
    APP_PUBLIC_URLS: ["http://localhost:3000"],
  } as Config);
});

afterAll(async () => {
  if (created.length > 0) {
    await db.execute(sql`delete from "user" where "id" in (${sql.join(created.map((id) => sql`${id}`), sql`, `)})`);
  }
  await pool.end();
});

describe("credential accounts written directly", () => {
  it("signs in an account created with a password", async () => {
    const email = `staff-${RUN}@example.com`;
    const userId = await insertCredentialUser(db, { email, name: "Rosa Quispe", role: "admin", password: "correct-horse-1" });
    created.push(userId);

    const result = await auth.api.signInEmail({ body: { email, password: "correct-horse-1" } });
    expect(result.user.id).toBe(userId);
    expect((result.user as unknown as { role: string }).role).toBe("admin");

    await expect(auth.api.signInEmail({ body: { email, password: "wrong-horse-1" } })).rejects.toThrow();
  });

  it("lower-cases the e-mail on the way in", async () => {
    const userId = await insertCredentialUser(db, {
      email: `Mixed-${RUN}@Example.com`,
      name: "Mixed",
      role: "admin",
      password: "correct-horse-1",
    });
    created.push(userId);
    const result = await auth.api.signInEmail({ body: { email: `mixed-${RUN}@example.com`, password: "correct-horse-1" } });
    expect(result.user.id).toBe(userId);
  });

  it("refuses an account with no password until one is set, then accepts it", async () => {
    const email = `student-${RUN}@gmail.com`;
    const userId = await insertPasswordlessUser(db, { email, name: "Ana Quispe", role: "student" });
    created.push(userId);

    await expect(auth.api.signInEmail({ body: { email, password: "anything-12" } })).rejects.toThrow();

    await upsertCredentialPassword(db, userId, "first-pass-12");
    await expect(auth.api.signInEmail({ body: { email, password: "first-pass-12" } })).resolves.toBeTruthy();

    await upsertCredentialPassword(db, userId, "second-pass-12");
    await expect(auth.api.signInEmail({ body: { email, password: "first-pass-12" } })).rejects.toThrow();
    await expect(auth.api.signInEmail({ body: { email, password: "second-pass-12" } })).resolves.toBeTruthy();
  });

  it("keeps the public sign-up closed, server calls included", async () => {
    await expect(
      auth.api.signUpEmail({ body: { email: `signup-${RUN}@example.com`, password: "whatever-123", name: "X" } }),
    ).rejects.toMatchObject({ body: { code: "EMAIL_PASSWORD_SIGN_UP_DISABLED" } });
  });

  it("refuses a staff account for an e-mail already taken, leaving no extra rows", async () => {
    const email = `taken-${RUN}@example.com`;
    const userId = await insertCredentialUser(db, { email, name: "First", role: "admin", password: "correct-horse-1" });
    created.push(userId);

    const provisioner = new BetterAuthStaffAccountProvisioner(db);
    await expect(
      provisioner.provision({ email: email.toUpperCase(), name: "Second", role: "teacher", profileId: null, password: "correct-horse-2" }),
    ).rejects.toSatisfy((e: unknown) => e instanceof ConflictError && e.reason === "staff_invite.email_taken");

    const users = await db.execute(sql`select count(*)::int as n from "user" where "email" = ${email}`);
    const accounts = await db.execute(sql`select count(*)::int as n from "account" where "userId" = ${userId}`);
    expect(users.rows[0]?.n).toBe(1);
    expect(accounts.rows[0]?.n).toBe(1);
  });
});
