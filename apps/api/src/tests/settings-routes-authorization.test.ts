import type { AuthenticatedUser, Role } from "@ooc/domain";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildApp } from "@/app.js";
import { container } from "@/container.js";
import { SESSION_COOKIE_NAME } from "@/infra/auth/betterAuth.js";

/**
 * CI gate §6.5 for the settings screen: management only. Billing settles
 * money but does not decide what the traffic light calls green. No database — the
 * authorization hook answers before the handler runs.
 */

const CASES: [string, string, Role][] = [
  ["GET", "/api/v1/settings", "billing"],
  ["PUT", "/api/v1/settings/checkout-hold", "enrollment_supervisor"],
  ["PUT", "/api/v1/settings/receipt-amount-tolerance", "billing"],
  ["PUT", "/api/v1/settings/receipt-amount-tolerance", "analyst"],
  ["PUT", "/api/v1/settings/receipt-reject-below", "billing"],
  ["PUT", "/api/v1/settings/receipt-reject-below", "support"],
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
