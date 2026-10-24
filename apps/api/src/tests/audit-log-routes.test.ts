import type { AuthenticatedUser } from "@ooc/domain";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { buildApp } from "@/app.js";
import { container } from "@/container.js";
import { SESSION_COOKIE_NAME } from "@/infra/auth/betterAuth.js";
import type { AuditLogRow } from "@/infra/persistence/audit/AuditLogQuery.js";
import { RATE_LIMITS } from "@/shared/http/rateLimit.js";

/**
 * OOC-122: the general audit log's routes hand the screen's filters to the
 * query, refuse a day that does not exist, and stream the export under its
 * own counter. No database: the query is stubbed.
 */

const ANALYST: AuthenticatedUser = { id: "u-analyst", email: "a@example.com", name: "A", role: "analyst", twoFactorEnabled: true };

const ROW: AuditLogRow = {
  id: "018f2b5c-0000-7000-8000-0000000000aa",
  at: new Date("2026-10-20T15:00:00.000Z"),
  action: "student_updated",
  entity: "student",
  subject: { entity: "student", id: "018f2b5c-0000-7000-8000-000000000001", label: "Rosa Quispe" },
  fields: ["email", "phone"],
  actor: { id: "u-admin", name: "Ana Admin", role: "admin" },
};

async function* batches(...groups: AuditLogRow[][]): AsyncGenerator<AuditLogRow[]> {
  for (const group of groups) {
    await Promise.resolve();
    yield group;
  }
}

let app: FastifyInstance;
beforeAll(async () => {
  app = await buildApp();
});
afterAll(async () => {
  await app.close();
});
afterEach(() => {
  vi.restoreAllMocks();
});

function signedInAs(user: AuthenticatedUser) {
  vi.spyOn(container.identity.currentSession, "resolve").mockResolvedValue(user);
  return vi.spyOn(container.edge.rateLimiter, "hit").mockResolvedValue(null);
}

const get = (url: string) => app.inject({ method: "GET", url, cookies: { [SESSION_COOKIE_NAME]: "token" } });

describe("GET /audit-log", () => {
  it("passes every filter and the cursor to the query", async () => {
    signedInAs(ANALYST);
    const page = vi.spyOn(container.queries.auditLog, "page").mockResolvedValue({ items: [ROW], nextCursor: "next" });

    const response = await get(
      "/api/v1/audit-log?from=2026-10-01&to=2026-10-20&actorId=u-admin&action=student_updated&entity=student&cursor=abc",
    );

    expect(response.statusCode).toBe(200);
    expect(page).toHaveBeenCalledWith(
      { from: "2026-10-01", to: "2026-10-20", actorId: "u-admin", action: "student_updated", entity: "student" },
      "abc",
    );
    expect(response.json()).toEqual({ items: [{ ...ROW, at: "2026-10-20T15:00:00.000Z" }], nextCursor: "next" });
  });

  it.each([
    ["a day that does not exist", "from=2026-02-30"],
    ["a period that ends before it starts", "from=2026-10-20&to=2026-10-01"],
    ["an action outside the catalogue", "action=payment.approved"],
    ["an entity outside the catalogue", "entity=enrollment"],
  ])("refuses %s", async (_name, search) => {
    signedInAs(ANALYST);
    const page = vi.spyOn(container.queries.auditLog, "page");

    const response = await get(`/api/v1/audit-log?${search}`);

    expect(response.statusCode).toBe(400);
    expect(page).not.toHaveBeenCalled();
  });
});

describe("GET /audit-log/export", () => {
  it("streams NDJSON under the caller, on its own counter", async () => {
    const hit = signedInAs(ANALYST);
    const exported = vi
      .spyOn(container.queries.auditLog, "export")
      .mockResolvedValue({ rowCount: 2, batches: batches([ROW], [{ ...ROW, id: "second" }]) });

    const response = await get("/api/v1/audit-log/export?entity=payment");

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("application/x-ndjson");
    expect(response.headers["x-row-count"]).toBe("2");
    expect(exported).toHaveBeenCalledWith({ entity: "payment" }, "u-analyst");
    expect(response.body.trimEnd().split("\n").map((line) => (JSON.parse(line) as { id: string }).id)).toEqual([ROW.id, "second"]);

    const keys = hit.mock.calls.map(([key]) => key);
    expect(keys.some((key) => key.includes(`:rl:${RATE_LIMITS.auditExport.name}:`))).toBe(true);
  });
});
