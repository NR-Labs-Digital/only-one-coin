import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@ooc/db";
import { BOARD_ROLES, defaultPermissionsOf, isGrantable } from "@ooc/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/infra/db/client.js";
import { DrizzleStaffProfileRepository } from "./DrizzleStaffProfileRepository.js";
import { DrizzleUserRoleRepository } from "./DrizzleUserRoleRepository.js";
import { StaffAccessRegistry } from "./StaffAccessRegistry.js";

/**
 * The cargos against the real tables (OOC-183): the board's rows land from
 * the catalog once, a created cargo stores and replaces its permissions, the
 * members count reads accounts and open invites, and `"user"` refuses a
 * `custom` role without a cargo (`user_profile_check`).
 */

const { Pool } = pg;
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("DATABASE_URL is required for this suite.");

const users: string[] = [];
let pool: pg.Pool;
let db: Db;
let repository: DrizzleStaffProfileRepository;

beforeAll(async () => {
  pool = new Pool({ connectionString: DATABASE_URL, max: 2 });
  db = drizzle(pool, { schema, casing: "snake_case" }) as unknown as Db;
  repository = new DrizzleStaffProfileRepository(db);
  await repository.syncBoard();
});

afterAll(async () => {
  for (const id of users) await db.execute(sql`delete from "user" where "id" = ${id}`);
  await pool.end();
});

describe("DrizzleStaffProfileRepository", () => {
  it("seeds every board cargo with its handed-out defaults, and a second sync changes nothing", async () => {
    const sales = await repository.findByRole("sales");
    expect(sales?.permissions.sort()).toEqual(defaultPermissionsOf("sales").filter(isGrantable).sort());
    for (const role of BOARD_ROLES) expect(await repository.findByRole(role)).not.toBeNull();

    await repository.update(sales!.id, { permissions: sales!.permissions.filter((key) => key !== "catalog.view") });
    await repository.syncBoard();
    expect((await repository.findByRole("sales"))?.permissions).not.toContain("catalog.view");
    await repository.update(sales!.id, { permissions: sales!.permissions });
  });

  it("creates a cargo, replaces its permissions and retires it", async () => {
    const name = `Horarios ${randomUUID().slice(0, 8)}`;
    const created = await repository.create({
      name,
      permissions: ["catalog.view", "catalog.courses_edit"],
      createdBy: "usr_test",
    });
    expect(await repository.nameTaken(name.toUpperCase())).toBe(true);
    expect(await repository.nameTaken(name, created.id)).toBe(false);

    await repository.update(created.id, { name: `${name} 2`, permissions: ["catalog.view"] });
    expect(await repository.findLiveById(created.id)).toMatchObject({ name: `${name} 2`, permissions: ["catalog.view"] });

    const registry = new StaffAccessRegistry(() => repository.loadLive());
    await registry.reload();
    expect(registry.has({ role: "custom", profileId: created.id }, "catalog.view")).toBe(true);
    expect(registry.has({ role: "custom", profileId: created.id }, "catalog.courses_edit")).toBe(false);

    await repository.retire(created.id);
    expect(await repository.findLiveById(created.id)).toBeNull();
  });

  it("counts the accounts on a cargo, and the user row refuses custom without one", async () => {
    const created = await repository.create({
      name: `Caja ${randomUUID().slice(0, 8)}`,
      permissions: [],
      createdBy: "usr_test",
    });
    const id = randomUUID();
    users.push(id);
    await db.execute(sql`
      insert into "user" ("id", "name", "email", "emailVerified", "role", "createdAt", "updatedAt")
      values (${id}, 'Astrid Test', ${`astrid-${id}@example.com`}, true, 'enrollment_supervisor', now(), now())`);

    const roles = new DrizzleUserRoleRepository(db);
    await roles.updateAssignment(id, { role: "custom", profileId: created.id });
    expect(await roles.findAssignmentByUserId(id)).toEqual({ role: "custom", profileId: created.id });
    expect(await repository.countMembers(created.id)).toBe(1);
    expect((await repository.listLive()).find((profile) => profile.id === created.id)?.members).toBe(1);

    await expect(
      db.execute(sql`update "user" set "role" = 'custom', "profile_id" = null where "id" = ${id}`),
    ).rejects.toThrow();
    await roles.updateAssignment(id, { role: "sales", profileId: null });
    expect(await repository.countMembers(created.id)).toBe(0);
  });
});
