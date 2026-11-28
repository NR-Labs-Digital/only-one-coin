import type { AuthenticatedUser, Role } from "@ooc/domain";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildApp } from "@/app.js";
import { container } from "@/container.js";
import { SESSION_COOKIE_NAME } from "@/infra/auth/betterAuth.js";

/**
 * CI gate §6.5 for the owners' demo accesses (28/11/2026): the e-mail domain
 * opens the door, never the cargo — a `master` or `admin` outside the owners'
 * domains is refused like any other account. No database: the authorization
 * hook answers before the handler runs.
 */

const ROUTES: [string, string][] = [
  ["GET", "/api/v1/platform/demo-accesses"],
  ["POST", "/api/v1/platform/demo-accesses"],
  ["POST", "/api/v1/platform/demo-accesses/0195f1d2-0000-7000-8000-000000000000/revoke"],
];
const ROLES: Role[] = ["master", "admin", "analyst", "billing", "enrollment_supervisor", "academic_supervisor", "teacher", "student"];

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
});

describe("demo access routes are the owners' alone", () => {
  for (const [method, url] of ROUTES) {
    it.each(ROLES)(`${method} ${url} refuses %s outside the owners' domain`, async (role) => {
      const user: AuthenticatedUser = { id: "u1", email: "x@onlyonecoin.edu.pe", name: "X", role, twoFactorEnabled: true };
      vi.spyOn(container.identity.currentSession, "resolve").mockResolvedValue(user);

      const response = await app.inject({
        method: method as "GET",
        url,
        cookies: { [SESSION_COOKIE_NAME]: "token" },
        payload: method === "GET" ? undefined : {},
      });

      expect(response.statusCode).toBe(403);
    });

    it(`${method} ${url} refuses without a session`, async () => {
      vi.spyOn(container.identity.currentSession, "resolve").mockResolvedValue(null);
      const response = await app.inject({ method: method as "GET", url });
      expect(response.statusCode).toBe(401);
    });
  }

  it.each(["x@nrlabsdigital.com", "x@admin.com"])("lets an owner (%s) through whatever the cargo", async (email) => {
    const user: AuthenticatedUser = { id: "u1", email, name: "X", role: "support", twoFactorEnabled: true };
    vi.spyOn(container.identity.currentSession, "resolve").mockResolvedValue(user);

    // Past the door, the body schema answers first: no database needed.
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/platform/demo-accesses",
      cookies: { [SESSION_COOKIE_NAME]: "token" },
      payload: {},
    });
    expect(response.statusCode).toBe(400);
  });
});
