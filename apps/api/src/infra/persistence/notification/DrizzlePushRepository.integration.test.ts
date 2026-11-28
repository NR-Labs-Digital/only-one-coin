import { randomUUID } from "node:crypto";
import { MAX_PUSH_SUBSCRIPTIONS_PER_ACCOUNT, type EmailNotification } from "@ooc/domain";
import { eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@ooc/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/infra/db/client.js";
import { insertOutboxEmails } from "./DrizzleOutboxRepository.js";
import { DrizzlePushRepository } from "./DrizzlePushRepository.js";

/**
 * Push on the portal (OOC-51) against the migrated database: which outbox
 * rows a writer marks for a push, the claim that makes a push at most once,
 * the 24 h window, and the devices of an account. "user", "outbox" and
 * "push_subscriptions" are outside the delete lock (0011), so afterAll removes
 * what the suite created.
 */

const { Pool } = pg;
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("DATABASE_URL is required for this suite.");

const users: string[] = [];
const dedupeKeys: string[] = [];
let pool: pg.Pool;
let db: Db;
let repository: DrizzlePushRepository;

async function insertUser(role = "student", banned = false): Promise<{ id: string; email: string }> {
  const id = randomUUID();
  const email = `Push-${id}@Example.com`;
  users.push(id);
  await db.execute(sql`
    insert into "user" ("id", "name", "email", "emailVerified", "role", "banned", "createdAt", "updatedAt")
    values (${id}, 'Rosa Test', ${email}, true, ${role}, ${banned}, now(), now())`);
  return { id, email };
}

function email(templateKey: EmailNotification["templateKey"], to: string): EmailNotification {
  const dedupeKey = `ooc51:${templateKey}:${randomUUID()}`;
  dedupeKeys.push(dedupeKey);
  return { templateKey, to, locale: "es-PE", vars: {}, dedupeKey } as unknown as EmailNotification;
}

async function rowOf(dedupeKey: string) {
  const [row] = await db
    .select({ id: schema.outbox.id, pushStatus: schema.outbox.pushStatus })
    .from(schema.outbox)
    .where(eq(schema.outbox.dedupeKey, dedupeKey));
  return row;
}

function device(n: number | string) {
  return { endpoint: `https://fcm.googleapis.com/fcm/send/${randomUUID()}-${n}`, p256dh: `k${n}`, auth: `a${n}` };
}

beforeAll(() => {
  pool = new Pool({ connectionString: DATABASE_URL, max: 2 });
  db = drizzle(pool, { schema, casing: "snake_case" });
  repository = new DrizzlePushRepository(db);
});

afterAll(async () => {
  if (dedupeKeys.length > 0) await db.delete(schema.outbox).where(inArray(schema.outbox.dedupeKey, dedupeKeys));
  if (users.length > 0) {
    await db.execute(sql`delete from "user" where "id" in (${sql.join(users.map((id) => sql`${id}`), sql`, `)})`);
  }
  await pool.end();
});

describe("which outbox rows wait for a push", () => {
  it("marks the journey e-mails and leaves the security ones alone", async () => {
    const journey = email("payment_approved", "rosa@example.com");
    const security = email("portal_password_reset", "rosa@example.com");
    await insertOutboxEmails(db, [journey, security]);

    expect((await rowOf(journey.dedupeKey)).pushStatus).toBe("pending");
    expect((await rowOf(security.dedupeKey)).pushStatus).toBeNull();
  });
});

describe("the push claim", () => {
  it("lists the pending row, claims it once and records how it ended", async () => {
    const message = email("grade_posted", "rosa@example.com");
    await insertOutboxEmails(db, [message]);
    const { id } = await rowOf(message.dedupeKey);

    expect(await repository.listPendingPushIds(10_000)).toContain(id);

    const claimed = await repository.claimPush(id);
    expect(claimed).toMatchObject({ id, templateKey: "grade_posted", recipient: "rosa@example.com", locale: "es-PE" });
    expect(await repository.claimPush(id)).toBeNull();
    expect(await repository.listPendingPushIds(10_000)).not.toContain(id);

    await repository.finishPush(id, "sent");
    expect((await rowOf(message.dedupeKey)).pushStatus).toBe("sent");
  });

  it("never offers nor claims a row older than a day", async () => {
    const message = email("payment_approved", "rosa@example.com");
    await insertOutboxEmails(db, [message]);
    const { id } = await rowOf(message.dedupeKey);
    await db.execute(sql`update outbox set created_at = now() - interval '25 hours' where id = ${id}`);

    expect(await repository.listPendingPushIds(10_000)).not.toContain(id);
    expect(await repository.claimPush(id)).toBeNull();
  });

  it("refuses an unknown push status (CHECK)", async () => {
    const message = email("payment_approved", "rosa@example.com");
    await insertOutboxEmails(db, [message]);
    await expect(
      db.execute(sql`update outbox set push_status = 'maybe' where dedupe_key = ${message.dedupeKey}`),
    ).rejects.toThrow();
  });
});

describe("the devices of an account", () => {
  it("finds the portal account's devices by its e-mail, without case", async () => {
    const rosa = await insertUser();
    const phone = device("phone");
    await repository.subscribe(rosa.id, phone);

    const found = await repository.listForRecipient(rosa.email.toLowerCase());
    expect(found).toEqual([phone]);
  });

  it("never pushes to a staff account or a blocked one", async () => {
    const staff = await insertUser("admin");
    const blocked = await insertUser("student", true);
    await repository.subscribe(staff.id, device("staff"));
    await repository.subscribe(blocked.id, device("blocked"));

    expect(await repository.listForRecipient(staff.email)).toEqual([]);
    expect(await repository.listForRecipient(blocked.email)).toEqual([]);
  });

  it("hands a browser over to the account that subscribed on it last", async () => {
    const [first, second] = [await insertUser(), await insertUser()];
    const shared = device("shared");
    await repository.subscribe(first.id, shared);
    await repository.subscribe(second.id, { ...shared, p256dh: "rotated" });

    expect(await repository.listForRecipient(first.email)).toEqual([]);
    expect(await repository.listForRecipient(second.email)).toEqual([{ ...shared, p256dh: "rotated" }]);
  });

  it(`keeps the newest ${MAX_PUSH_SUBSCRIPTIONS_PER_ACCOUNT} devices of an account`, async () => {
    const rosa = await insertUser();
    const devices = Array.from({ length: MAX_PUSH_SUBSCRIPTIONS_PER_ACCOUNT + 2 }, (_, n) => device(n));
    for (const each of devices) await repository.subscribe(rosa.id, each);

    const kept = await repository.listForRecipient(rosa.email);
    expect(kept).toHaveLength(MAX_PUSH_SUBSCRIPTIONS_PER_ACCOUNT);
    expect(kept.map((d) => d.endpoint)).not.toContain(devices[0].endpoint);
    expect(kept.map((d) => d.endpoint)).toContain(devices.at(-1)!.endpoint);
  });

  it("unsubscribes only the session's own device, and forgets a gone one", async () => {
    const [rosa, other] = [await insertUser(), await insertUser()];
    const phone = device("mine");
    await repository.subscribe(rosa.id, phone);

    await repository.unsubscribe(other.id, phone.endpoint);
    expect(await repository.listForRecipient(rosa.email)).toEqual([phone]);

    await repository.unsubscribe(rosa.id, phone.endpoint);
    expect(await repository.listForRecipient(rosa.email)).toEqual([]);

    const laptop = device("gone");
    await repository.subscribe(rosa.id, laptop);
    await repository.forgetEndpoint(laptop.endpoint);
    expect(await repository.listForRecipient(rosa.email)).toEqual([]);
  });
});
