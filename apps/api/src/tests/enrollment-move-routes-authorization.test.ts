import type { AuthenticatedUser, Role } from "@ooc/domain";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildApp } from "@/app.js";
import { container } from "@/container.js";
import { SESSION_COOKIE_NAME } from "@/infra/auth/betterAuth.js";

/**
 * CI gate §6.5 for moving an enrollment (OOC-84): only whoever opens a manual
 * enrollment moves one — master, admin, enrollment_supervisor. The handler
 * never runs, so no database is needed.
 */

const ID = "018f2b5c-0000-7000-8000-000000000001";
const REFUSED: Role[] = ["billing", "analyst", "sales", "support", "academic_supervisor", "academic_assistant", "teacher", "student"];

const ROUTES: [string, string][] = [
  ["GET", `/api/v1/enrollments/${ID}/move-targets`],
  ["POST", `/api/v1/enrollments/${ID}/move`],
];

const CASES: [string, string, Role][] = ROUTES.flatMap(([method, url]) =>
  REFUSED.map((role): [string, string, Role] => [method, url, role]),
);

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
});

describe("enrollment move routes refuse undeclared roles", () => {
  it.each(CASES)("%s %s refuses %s", async (method, url, role) => {
    const user: AuthenticatedUser = { id: "u1", email: "x@example.com", name: "X", role, twoFactorEnabled: true };
    vi.spyOn(container.identity.currentSession, "resolve").mockResolvedValue(user);

    const response = await app.inject({
      method: method as "GET" | "POST",
      url,
      cookies: { [SESSION_COOKIE_NAME]: "token" },
      ...(method === "POST" ? { payload: { classGroupId: ID, reason: "x" } } : {}),
    });

    expect(response.statusCode).toBe(403);
  });

  it("answers 401 without a session", async () => {
    const response = await app.inject({ method: "GET", url: `/api/v1/enrollments/${ID}/move-targets` });
    expect(response.statusCode).toBe(401);
  });
});
