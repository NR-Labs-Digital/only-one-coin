import {
  BOARD_ROLES,
  PERMISSION_CATALOG,
  defaultPermissionsOf,
  isPermissionKey,
  type AuthenticatedUser,
  type PermissionKey,
  type Role,
  type StaffProfileRecord,
} from "@ooc/domain";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { buildApp } from "@/app.js";
import { container } from "@/container.js";
import { SESSION_COOKIE_NAME } from "@/infra/auth/betterAuth.js";
import { StaffAccessRegistry } from "@/infra/identity/StaffAccessRegistry.js";

/**
 * Cargos as data (OOC-57, OOC-183). Every staff route declares one permission
 * of the catalog, deny-by-default still holds (CI gate §6.5), and the board's
 * defaults are the access each cargo had when the routes declared roles — no
 * account gained or lost anything in the move.
 */

/** Permissions with no route of their own: they shape what a response carries, or name the owners' door. */
const ROUTELESS: PermissionKey[] = ["payments.view_contact", "catalog.roster_contact", "settings.feature_flags"];

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function signInAs(role: Role, extra: Partial<AuthenticatedUser> = {}) {
  const user: AuthenticatedUser = { id: "u1", email: "x@example.com", name: "X", role, twoFactorEnabled: true, ...extra };
  vi.spyOn(container.identity.currentSession, "resolve").mockResolvedValue(user);
}

describe("permission catalog", () => {
  it("has unique keys", () => {
    const keys = PERMISSION_CATALOG.map((entry) => entry.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("is declared by every route a staff account can reach — roles stay only on the portal's doors", () => {
    const offenders = app.declaredRoutes
      .filter(({ auth }) => !auth.public && "roles" in auth)
      .filter(({ auth }) => "roles" in auth && auth.roles.some((role) => role !== "student" && role !== "guardian"))
      .map((route) => `${route.method} ${route.url}`);
    expect(offenders).toEqual([]);

    const unknown = app.declaredRoutes
      .filter(({ auth }) => !auth.public && "permission" in auth && !isPermissionKey(auth.permission))
      .map((route) => `${route.method} ${route.url}`);
    expect(unknown).toEqual([]);
  });

  it("names no permission that neither a route nor a response uses", () => {
    const declared = new Set(
      app.declaredRoutes.flatMap(({ auth }) => (!auth.public && "permission" in auth ? [auth.permission] : [])),
    );
    const unused = PERMISSION_CATALOG.map((entry) => entry.key).filter(
      (key) => !declared.has(key) && !ROUTELESS.includes(key),
    );
    expect(unused).toEqual([]);
  });

  it("keeps the board's sensitive doors where they were", () => {
    const holders = (key: PermissionKey) => BOARD_ROLES.filter((role) => defaultPermissionsOf(role).includes(key));
    expect(holders("payments.settle")).toEqual(["master", "admin", "billing"]);
    expect(holders("team.change_role")).toEqual(["master", "admin"]);
    expect(holders("team.profiles")).toEqual(["master", "admin"]);
    expect(holders("students.view")).toEqual(["master", "admin", "enrollment_supervisor"]);
    expect(holders("teaching.own_grades")).toEqual(["teacher"]);
    expect(holders("settings.feature_flags")).toEqual([]);
  });

  it("requires the second factor of exactly master, admin and billing by default", () => {
    const registry = new StaffAccessRegistry(async () => []);
    expect(BOARD_ROLES.filter((role) => registry.requiresMfa({ role }))).toEqual(["master", "admin", "billing"]);
  });
});

describe("StaffAccessRegistry", () => {
  const custom: StaffProfileRecord = {
    id: "p-astrid",
    role: null,
    name: "Coordinación de horarios",
    permissions: ["catalog.view", "catalog.courses_edit", "catalog.course_options"],
  };

  it("gives a created cargo exactly its permissions, plus an account's own settings", async () => {
    const registry = new StaffAccessRegistry(async () => [custom]);
    await registry.reload();
    expect([...registry.permissionsOf({ role: "custom", profileId: "p-astrid" })].sort()).toEqual(
      ["account.self", "catalog.course_options", "catalog.courses_edit", "catalog.view"].sort(),
    );
    expect(registry.requiresMfa({ role: "custom", profileId: "p-astrid" })).toBe(false);
  });

  it("gives nothing to a custom account whose cargo is gone or unnamed — a null id is not an id", async () => {
    const registry = new StaffAccessRegistry(async () => [custom]);
    await registry.reload();
    expect(registry.permissionsOf({ role: "custom", profileId: "p-retired" }).size).toBe(0);
    expect(registry.permissionsOf({ role: "custom", profileId: null }).size).toBe(0);
    expect(registry.permissionsOf({ role: "student" }).size).toBe(0);
  });

  it("reads an edited board cargo, but never lets master or teacher drift from the code", async () => {
    const registry = new StaffAccessRegistry(async () => [
      { id: "b-sup", role: "enrollment_supervisor", name: null, permissions: ["catalog.courses_edit"] },
      { id: "b-master", role: "master", name: null, permissions: [] },
    ]);
    await registry.reload();
    expect(registry.has({ role: "enrollment_supervisor" }, "catalog.courses_edit")).toBe(true);
    expect(registry.has({ role: "enrollment_supervisor" }, "students.view")).toBe(false);
    expect(registry.has({ role: "master" }, "payments.settle")).toBe(true);
  });

  it("makes a cargo holding a sensitive permission sign in with the second factor", async () => {
    const registry = new StaffAccessRegistry(async () => [{ ...custom, permissions: ["payments.view", "payments.settle"] }]);
    await registry.reload();
    expect(registry.requiresMfa({ role: "custom", profileId: "p-astrid" })).toBe(true);
  });
});

describe("authorization by permission", () => {
  it("lets a custom account through only the doors its cargo holds", async () => {
    const registry = container.identity.staffAccess;
    vi.spyOn(registry, "has").mockImplementation((_subject, permission) => permission === "catalog.view");
    vi.spyOn(registry, "requiresMfa").mockReturnValue(false);
    signInAs("custom", { profileId: "p-astrid" });

    const refused = await app.inject({
      method: "GET",
      url: "/api/v1/payments",
      cookies: { [SESSION_COOKIE_NAME]: "token" },
    });
    expect(refused.statusCode).toBe(403);
  });
});

describe("cargo routes", () => {
  const READERS: Role[] = ["master", "admin", "analyst"];
  const REFUSED: Role[] = [
    "enrollment_supervisor",
    "academic_supervisor",
    "academic_assistant",
    "teacher",
    "sales",
    "support",
    "billing",
    "student",
    "custom",
  ];

  it.each(REFUSED)("GET /staff/permissions refuses %s", async (role) => {
    signInAs(role);
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/staff/permissions",
      cookies: { [SESSION_COOKIE_NAME]: "token" },
    });
    expect(response.statusCode).toBe(403);
  });

  it.each(READERS)("GET /staff/permissions answers %s", async (role) => {
    signInAs(role);
    vi.spyOn(container.identity.staffProfileRepository, "listLive").mockResolvedValue(
      BOARD_ROLES.map((board) => ({
        id: `00000000-0000-7000-8000-00000000000${BOARD_ROLES.indexOf(board)}`,
        role: board,
        name: null,
        permissions: defaultPermissionsOf(board),
        members: 1,
      })),
    );
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/staff/permissions",
      cookies: { [SESSION_COOKIE_NAME]: "token" },
    });
    expect(response.statusCode).toBe(200);
    const items = response.json<{ items: { role: string; editable: boolean; locked: boolean }[] }>().items;
    expect(items).toHaveLength(BOARD_ROLES.length);
    // Never one's own, never a locked one; the analyst edits nothing.
    const editable = items.filter((item) => item.editable).map((item) => item.role);
    expect(editable).not.toContain(role);
    expect(editable).not.toContain("master");
    expect(editable).not.toContain("teacher");
    if (role === "analyst") expect(editable).toEqual([]);
  });

  it.each(["analyst", "enrollment_supervisor", "billing"] as Role[])("POST /staff/profiles refuses %s", async (role) => {
    signInAs(role);
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/staff/profiles",
      cookies: { [SESSION_COOKIE_NAME]: "token" },
      payload: { name: "Horarios", permissions: ["catalog.view"] },
    });
    expect(response.statusCode).toBe(403);
  });
});
