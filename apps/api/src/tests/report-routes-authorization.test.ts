import type { AuthenticatedUser, Role } from "@ooc/domain";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { buildApp } from "@/app.js";
import { container } from "@/container.js";
import { SESSION_COOKIE_NAME } from "@/infra/auth/betterAuth.js";
import type { ReportResult } from "@/infra/persistence/report/ReportQuery.js";

/**
 * CI gate §6.5 for the reports (OOC-40): management, the analyst and the two
 * supervisors, as `canBrowseReports` in the app. Billing, sales, support, a
 * teacher and a student are refused before the handler; the allowed case
 * stubs the query, so no database is needed.
 */

const URL = "/api/v1/reports";

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

function signIn(role: Role): void {
  const user: AuthenticatedUser = { id: "u1", email: "x@example.com", name: "X", role, twoFactorEnabled: true };
  vi.spyOn(container.identity.currentSession, "resolve").mockResolvedValue(user);
}

const EMPTY: ReportResult = {
  refreshedAt: new Date("2026-11-20T09:00:00.000Z"),
  periods: [],
  periodId: null,
  dimension: "course",
  rows: [],
  totals: { enrollments: 0, reserved: 0, collectedCents: 0, pendingCents: 0, pendingCount: 0, seatsTaken: 0, capacity: 0, classGroups: 0 },
  months: [],
  trend: { periods: [], series: [] },
  rankings: { volume: [], lowGrades: [] },
};

describe("GET /reports", () => {
  it("refuses a request without a session", async () => {
    const response = await app.inject({ method: "GET", url: URL });
    expect(response.statusCode).toBe(401);
  });

  it.each<Role>(["billing", "sales", "support", "teacher", "student"])("refuses %s", async (role) => {
    signIn(role);
    const response = await app.inject({ method: "GET", url: URL, cookies: { [SESSION_COOKIE_NAME]: "token" } });
    expect(response.statusCode).toBe(403);
  });

  it.each<Role>(["master", "admin", "analyst", "enrollment_supervisor", "academic_supervisor"])("serves %s", async (role) => {
    signIn(role);
    const run = vi.spyOn(container.queries.report, "run").mockResolvedValue(EMPTY);

    const response = await app.inject({
      method: "GET",
      url: `${URL}?period=all&dimension=teacher`,
      cookies: { [SESSION_COOKIE_NAME]: "token" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ refreshedAt: "2026-11-20T09:00:00.000Z", rows: [] });
    expect(run).toHaveBeenCalledWith({ period: "all", dimension: "teacher" });
  });

  it("refuses a period that is neither an id nor all", async () => {
    signIn("admin");
    const response = await app.inject({ method: "GET", url: `${URL}?period=2026-II`, cookies: { [SESSION_COOKIE_NAME]: "token" } });
    expect(response.statusCode).toBe(400);
  });
});
