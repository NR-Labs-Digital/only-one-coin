import Fastify, { type FastifyInstance } from "fastify";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@ooc/db";
import type { AuditLogEntry, IAuditLogRepository } from "@ooc/domain";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Config } from "@/config.js";
import type { Db } from "@/infra/db/client.js";
import { registerAuthRoutes } from "@/http/auth/AuthCatchAllRoute.js";
import { StaffAccessRegistry } from "@/infra/identity/StaffAccessRegistry.js";
import { DrizzleStaffAccessRepository } from "@/infra/identity/DrizzleStaffAccessRepository.js";
import { BetterAuthStaffSessionRevoker } from "@/infra/identity/BetterAuthStaffSessionRevoker.js";
import { createAuth, type Auth } from "./betterAuth.js";
import { insertCredentialUser } from "./credentialAccount.js";
import { DrizzleStaffTrustedBrowsers, TrustedBrowserGate } from "./trustedBrowsers.js";

/**
 * "Remember this browser" (OOC-154) through the real thing: Better Auth's
 * `twoFactor` plugin behind apps/api's auth catch-all, against a migrated
 * Postgres. What only this proves: the cookie formats the gate parses, the
 * cargo check at both ends (ticking the box, and the next password), the
 * window not rolling forward, and what forgets a remembered browser.
 *
 * Better Auth reads through its own pool, so rows are committed and removed in
 * afterAll ("user" is not under the delete lock; session and account cascade).
 */

const { Pool } = pg;
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("DATABASE_URL is required for this suite.");

const RUN = Date.now().toString(36);
const PASSWORD = "integration-password-123";
const created: string[] = [];

let pool: pg.Pool;
let db: Db;
let auth: Auth;
let app: FastifyInstance;
const codes = new Map<string, string>();
const audit: AuditLogEntry[] = [];

class MemoryAudit implements IAuditLogRepository {
  async append(entry: AuditLogEntry) {
    audit.push(entry);
  }
}

beforeAll(async () => {
  pool = new Pool({ connectionString: DATABASE_URL, max: 3 });
  db = drizzle(pool, { schema, casing: "snake_case" });
  auth = createAuth(
    {
      NODE_ENV: "test",
      PORT: 3333,
      DATABASE_URL,
      BETTER_AUTH_URL: "http://localhost:3333/api/auth",
      BETTER_AUTH_SECRET: "integration-secret-at-least-32-characters",
      APP_PUBLIC_URLS: ["http://localhost:3000"],
    } as Config,
    {
      codeSender: {
        send: async ({ userId, code }) => {
          codes.set(userId, code);
        },
      },
    },
  );
  // No database read: the board's default cargos (sales optional, admin mandatory).
  const staffAccess = new StaffAccessRegistry(async () => []);
  app = Fastify();
  registerAuthRoutes(app, auth, {
    trustedBrowsers: new TrustedBrowserGate(db, staffAccess),
    auditLog: new MemoryAudit(),
  });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  if (created.length > 0) {
    const ids = sql.join(created.map((id) => sql`${id}`), sql`, `);
    await db.execute(sql`delete from "verification" where "value" in (${ids})`);
    await db.execute(sql`delete from "user" where "id" in (${ids})`);
  }
  await pool.end();
});

beforeEach(() => {
  audit.length = 0;
});

async function staffWithFactor(role: "sales" | "admin"): Promise<{ id: string; email: string }> {
  const email = `ooc154.${role}.${RUN}.${created.length}@example.com`;
  const id = await insertCredentialUser(db, { email, name: "Prueba Navegador", role, password: PASSWORD });
  created.push(id);
  await db.execute(sql`update "user" set "twoFactorEnabled" = true where "id" = ${id}`);
  return { id, email };
}

/** The `name=value` pairs a response set, by cookie name. */
function setCookies(response: { headers: Record<string, unknown> }): Map<string, string> {
  const raw = response.headers["set-cookie"];
  const list = Array.isArray(raw) ? (raw as string[]) : typeof raw === "string" ? [raw] : [];
  const jar = new Map<string, string>();
  for (const cookie of list) {
    const pair = cookie.split(";")[0]!;
    const name = pair.split("=")[0]!;
    jar.set(name, pair);
  }
  return jar;
}

async function signIn(email: string, cookie?: string) {
  return app.inject({
    method: "POST",
    url: "/api/auth/sign-in/email",
    payload: { email, password: PASSWORD },
    headers: cookie ? { cookie } : {},
  });
}

/** Password, code, and the box as given; answers the cookie jar of the code step. */
async function signInWithCode(account: { id: string; email: string }, trustDevice: boolean) {
  const first = await signIn(account.email);
  expect(first.json()).toMatchObject({ twoFactorRedirect: true });
  const challenge = setCookies(first).get("better-auth.two_factor")!;
  expect(challenge).toBeDefined();

  const sent = await app.inject({ method: "POST", url: "/api/auth/two-factor/send-otp", payload: {}, headers: { cookie: challenge } });
  expect(sent.statusCode).toBe(200);

  const verified = await app.inject({
    method: "POST",
    url: "/api/auth/two-factor/verify-otp",
    payload: { code: codes.get(account.id), trustDevice },
    headers: { cookie: challenge },
  });
  expect(verified.statusCode).toBe(200);
  return { first, jar: setCookies(verified) };
}

async function trustRows(userId: string) {
  const result = await db.execute<{ identifier: string; expiresAt: Date }>(
    sql`select "identifier", "expiresAt" from "verification" where "value" = ${userId} and "identifier" like 'trust-device-%'`,
  );
  return result.rows.map((row) => ({ identifier: row.identifier, expiresAt: new Date(row.expiresAt) }));
}

describe("a cargo whose factor is optional", () => {
  it("is offered the box, is remembered, and the next password skips the code", async () => {
    const account = await staffWithFactor("sales");
    const { first, jar } = await signInWithCode(account, true);

    expect(first.json()).toMatchObject({ trustBrowser: true });
    const trust = jar.get("better-auth.trust_device");
    expect(trust).toBeDefined();
    expect(await trustRows(account.id)).toHaveLength(1);
    expect(audit).toEqual([expect.objectContaining({ action: "staff.browser_trusted", targetId: account.id })]);

    const again = await signIn(account.email, trust);
    expect(again.statusCode).toBe(200);
    expect(again.json()).not.toHaveProperty("twoFactorRedirect");
    expect(setCookies(again).get("better-auth.session_token")).toBeDefined();
  });

  it("keeps the first expiry when the plugin rotates the row", async () => {
    const account = await staffWithFactor("sales");
    const { jar } = await signInWithCode(account, true);
    const [before] = await trustRows(account.id);
    // Pretend the box was ticked ten days ago.
    const tenDaysLess = new Date(before!.expiresAt.getTime() - 10 * 24 * 60 * 60 * 1000);
    await db.execute(sql`update "verification" set "expiresAt" = ${tenDaysLess.toISOString()}::timestamptz where "identifier" = ${before!.identifier}`);

    const again = await signIn(account.email, jar.get("better-auth.trust_device"));
    expect(again.json()).not.toHaveProperty("twoFactorRedirect");

    const [after] = await trustRows(account.id);
    expect(after!.identifier).not.toBe(before!.identifier);
    expect(after!.expiresAt.getTime()).toBe(tenDaysLess.getTime());
  });

  it("is asked for the code again once the account's cargo makes it mandatory", async () => {
    const account = await staffWithFactor("sales");
    const { jar } = await signInWithCode(account, true);
    await db.execute(sql`update "user" set "role" = 'admin' where "id" = ${account.id}`);

    const again = await signIn(account.email, jar.get("better-auth.trust_device"));
    expect(again.json()).toMatchObject({ twoFactorRedirect: true, trustBrowser: false });
  });

  it("is forgotten by the account, by a new password, and by being blocked", async () => {
    const trustedBrowsers = new DrizzleStaffTrustedBrowsers(db);
    const revoker = new BetterAuthStaffSessionRevoker(auth, db);
    const access = new DrizzleStaffAccessRepository(db);

    const a = await staffWithFactor("sales");
    await signInWithCode(a, true);
    expect(await trustedBrowsers.count(a.id)).toBe(1);
    expect(await trustedBrowsers.forgetAll(a.id)).toBe(1);
    expect(await trustedBrowsers.count(a.id)).toBe(0);

    const b = await staffWithFactor("sales");
    await signInWithCode(b, true);
    await revoker.revokeAll(b.id);
    expect(await trustedBrowsers.count(b.id)).toBe(0);

    const c = await staffWithFactor("sales");
    await signInWithCode(c, true);
    await access.ban(c.id, "backoffice_access_removed");
    expect(await trustedBrowsers.count(c.id)).toBe(0);
  });
});

describe("a cargo whose factor is mandatory", () => {
  it("is not offered the box, and ticking it anyway remembers nothing", async () => {
    const account = await staffWithFactor("admin");
    const { first, jar } = await signInWithCode(account, true);

    expect(first.json()).toMatchObject({ trustBrowser: false });
    expect(jar.get("better-auth.trust_device")).toBeUndefined();
    expect(await trustRows(account.id)).toHaveLength(0);
    expect(audit).toEqual([]);
  });

});
