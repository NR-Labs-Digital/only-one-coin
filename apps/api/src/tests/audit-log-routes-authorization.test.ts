import type { AuthenticatedUser, Role } from "@ooc/domain";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildApp } from "@/app.js";
import { container } from "@/container.js";
import { SESSION_COOKIE_NAME } from "@/infra/auth/betterAuth.js";

/**
 * CI gate §6.5 for the general audit log (OOC-122): management and the
 * analyst read it; every other cargo is refused before the handler runs, so
 * no database is needed.
 */

const ROUTES = ["/api/v1/audit-log", "/api/v1/audit-log/actors", "/api/v1/audit-log/export"];

const REFUSED: Role[] = ["enrollment_supervisor", "academic_supervisor", "teacher", "sales", "support", "billing"];

const CASES = ROUTES.flatMap((url) => REFUSED.map((role) => [url, role] as const));

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
});

describe("audit log routes refuse undeclared roles", () => {
  it.each(CASES)("GET %s refuses %s", async (url, role) => {
    const user: AuthenticatedUser = { id: "u1", email: "x@example.com", name: "X", role, twoFactorEnabled: true };
    vi.spyOn(container.identity.currentSession, "resolve").mockResolvedValue(user);

    const response = await app.inject({ method: "GET", url, cookies: { [SESSION_COOKIE_NAME]: "token" } });

    expect(response.statusCode).toBe(403);
  });
});
