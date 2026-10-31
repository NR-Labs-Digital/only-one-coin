import type { AuthenticatedUser, Role } from "@ooc/domain";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { buildApp } from "@/app.js";
import { container } from "@/container.js";
import { SESSION_COOKIE_NAME } from "@/infra/auth/betterAuth.js";

/**
 * CI gate §6.5 for the automatic e-mails' screens (OOC-88): management, the
 * enrollment supervisor and the analyst read them; every other cargo, and the
 * student, is refused before the handler runs, so no database is needed.
 */

const ROUTES = [
  "/api/v1/emails/flows",
  "/api/v1/emails/flows/payment_approved",
  "/api/v1/emails/flows/payment_approved/preview",
];

const REFUSED: Role[] = ["academic_supervisor", "teacher", "sales", "support", "billing", "student"];

const CASES = ROUTES.flatMap((url) => REFUSED.map((role) => [url, role] as const));

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

describe("e-mail flow routes refuse undeclared roles", () => {
  it.each(CASES)("GET %s refuses %s", async (url, role) => {
    const user: AuthenticatedUser = { id: "u1", email: "x@example.com", name: "X", role, twoFactorEnabled: true };
    vi.spyOn(container.identity.currentSession, "resolve").mockResolvedValue(user);

    const response = await app.inject({ method: "GET", url, cookies: { [SESSION_COOKIE_NAME]: "token" } });

    expect(response.statusCode).toBe(403);
  });

  it.each(ROUTES)("GET %s refuses a request without a session", async (url) => {
    const response = await app.inject({ method: "GET", url });

    expect(response.statusCode).toBe(401);
  });
});
