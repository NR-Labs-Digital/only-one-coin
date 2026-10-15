import type { AuthenticatedUser, Role } from "@ooc/domain";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildApp } from "@/app.js";
import { container } from "@/container.js";
import { SESSION_COOKIE_NAME } from "@/infra/auth/betterAuth.js";

/**
 * CI gate §6.5 for Payments: every payment route answers 403 to a role it did
 * not declare. The handler never runs (the authorization hook answers first),
 * so no database is needed.
 */

const ID = "018f2b5c-0000-7000-8000-000000000001";

/** [method, url, a role that must be refused] */
const CASES: [string, string, Role][] = [
  ["GET", "/api/v1/payments", "enrollment_supervisor"],
  ["GET", "/api/v1/payments", "teacher"],
  ["GET", "/api/v1/payments/review", "sales"],
  ["GET", `/api/v1/payments/${ID}/receipt`, "support"],
  ["GET", `/api/v1/payments/${ID}/receipt`, "enrollment_supervisor"],
  // Whoever opens a manual enrollment does not settle its money (CLAUDE.md §1, lock (d)).
  ["POST", `/api/v1/payments/${ID}/approve`, "enrollment_supervisor"],
  ["POST", `/api/v1/payments/${ID}/approve`, "analyst"],
  ["POST", `/api/v1/payments/${ID}/approve`, "support"],
  ["POST", `/api/v1/payments/${ID}/reject`, "enrollment_supervisor"],
  ["POST", `/api/v1/payments/${ID}/reject`, "sales"],
];

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
});

describe("payment routes refuse undeclared roles", () => {
  it.each(CASES)("%s %s refuses %s", async (method, url, role) => {
    const user: AuthenticatedUser = { id: "u1", email: "x@example.com", name: "X", role, twoFactorEnabled: true };
    vi.spyOn(container.identity.currentSession, "resolve").mockResolvedValue(user);

    const response = await app.inject({
      method: method as "GET",
      url,
      cookies: { [SESSION_COOKIE_NAME]: "token" },
      payload: method === "GET" ? undefined : {},
    });

    expect(response.statusCode).toBe(403);
  });
});
