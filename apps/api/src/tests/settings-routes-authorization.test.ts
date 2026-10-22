import type { AuthenticatedUser, Role } from "@ooc/domain";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildApp } from "@/app.js";
import { container } from "@/container.js";
import { SESSION_COOKIE_NAME } from "@/infra/auth/betterAuth.js";

/**
 * CI gate §6.5 for the settings (OOC-41): every staff cargo reads them —
 * grades, certificates and contracts run on these numbers — but only
 * management changes them. Billing settles money but does not decide what the
 * traffic light calls green. Students and guardians never read them here. No
 * database — the authorization hook answers before the handler runs.
 */

const CASES: [string, string, Role][] = [
  ["GET", "/api/v1/settings", "student"],
  ["GET", "/api/v1/settings", "guardian"],
  ["PATCH", "/api/v1/settings", "billing"],
  ["PATCH", "/api/v1/settings", "analyst"],
  ["PATCH", "/api/v1/settings", "enrollment_supervisor"],
  ["PATCH", "/api/v1/settings", "academic_supervisor"],
  ["PATCH", "/api/v1/settings", "support"],
  ["PATCH", "/api/v1/settings", "teacher"],
];

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
});

describe("settings routes refuse undeclared roles", () => {
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
