import type { AuthenticatedUser, Role } from "@ooc/domain";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { buildApp } from "@/app.js";
import { container } from "@/container.js";
import { SESSION_COOKIE_NAME } from "@/infra/auth/betterAuth.js";

/**
 * CI gate §6.5 for the home's headline numbers (OOC-67): the same people who
 * read the catalog and the enrollment ledger. Billing sees no academic data
 * and a teacher has a home of their own. The refusals answer before the
 * handler; the allowed case stubs the query, so no database is needed.
 */

const URL = "/api/v1/dashboard/summary";

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

describe("GET /dashboard/summary", () => {
  it("refuses a request without a session", async () => {
    const response = await app.inject({ method: "GET", url: URL });
    expect(response.statusCode).toBe(401);
  });

  it.each<Role>(["billing", "teacher", "student"])("refuses %s", async (role) => {
    signIn(role);
    const response = await app.inject({ method: "GET", url: URL, cookies: { [SESSION_COOKIE_NAME]: "token" } });
    expect(response.statusCode).toBe(403);
  });

  it.each<Role>(["master", "admin", "analyst", "enrollment_supervisor", "academic_supervisor", "sales", "support"])(
    "serves %s",
    async (role) => {
      signIn(role);
      const summary = { enrollmentsToday: 3, enrollmentsYesterday: 5, activeStudents: 120, activeStudentsYesterday: 118 };
      vi.spyOn(container.queries.dashboardSummary, "run").mockResolvedValue(summary);

      const response = await app.inject({ method: "GET", url: URL, cookies: { [SESSION_COOKIE_NAME]: "token" } });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual(summary);
    },
  );
});
