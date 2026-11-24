import type { AuthenticatedUser, Role } from "@ooc/domain";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { buildApp } from "@/app.js";
import { container } from "@/container.js";
import { SESSION_COOKIE_NAME } from "@/infra/auth/betterAuth.js";

/**
 * CI gate §6.5 for freezing (OOC-84): a seat act, like moving one — master,
 * admin and enrollment_supervisor only. Everyone else is refused before the
 * handler runs, so no database is needed.
 */

const ENROLLMENT = "018f2b5c-8400-7000-8000-000000000010";
const REFUSED: Role[] = ["analyst", "academic_supervisor", "academic_assistant", "teacher", "sales", "support", "billing", "student"];
const ROUTES = [
  { method: "POST" as const, url: `/api/v1/enrollments/${ENROLLMENT}/freeze` },
  { method: "GET" as const, url: `/api/v1/enrollments/${ENROLLMENT}/return-runs` },
  { method: "POST" as const, url: `/api/v1/enrollments/${ENROLLMENT}/return` },
];

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

function signInAs(role: Role) {
  const user: AuthenticatedUser = { id: "u1", email: "x@example.com", name: "X", role, twoFactorEnabled: true };
  vi.spyOn(container.identity.currentSession, "resolve").mockResolvedValue(user);
}

describe("the freeze routes", () => {
  it.each(ROUTES.flatMap((route) => REFUSED.map((role) => [route.method, route.url, role] as const)))(
    "%s %s refuses %s",
    async (method, url, role) => {
      signInAs(role);
      const response = await app.inject({
        method,
        url,
        ...(method === "POST" ? { payload: {} } : {}),
        cookies: { [SESSION_COOKIE_NAME]: "token" },
      });
      expect(response.statusCode).toBe(403);
    },
  );

  it.each(ROUTES)("$method $url refuses a request without a session", async ({ method, url }) => {
    const response = await app.inject({ method, url, ...(method === "POST" ? { payload: {} } : {}) });
    expect(response.statusCode).toBe(401);
  });
});
