import type { AuthenticatedUser, Role } from "@ooc/domain";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildApp } from "@/app.js";
import { container } from "@/container.js";
import { SESSION_COOKIE_NAME } from "@/infra/auth/betterAuth.js";

/**
 * CI gate §6.5 for the undelivered e-mails screen (OOC-90): the e-mail
 * section's cargos read it, the analyst does not resend, and everybody else
 * is refused before the handler runs — no database needed.
 */

const ROW = "018f2b5c-4000-7000-8000-0000000000aa";

const CASES: (readonly ["GET" | "POST", string, Role])[] = [
  ...(["academic_supervisor", "teacher", "sales", "support", "billing"] as const).map(
    (role) => ["GET", "/api/v1/emails/deliveries", role] as const,
  ),
  ...(["analyst", "academic_supervisor", "teacher", "sales", "support", "billing"] as const).map(
    (role) => ["POST", `/api/v1/emails/deliveries/${ROW}/resend`, role] as const,
  ),
];

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
});

describe("e-mail delivery routes refuse undeclared roles", () => {
  it.each(CASES)("%s %s refuses %s", async (method, url, role) => {
    const user: AuthenticatedUser = { id: "u1", email: "x@example.com", name: "X", role, twoFactorEnabled: true };
    vi.spyOn(container.identity.currentSession, "resolve").mockResolvedValue(user);

    const response = await app.inject({
      method,
      url,
      cookies: { [SESSION_COOKIE_NAME]: "token" },
      payload: method === "GET" ? undefined : {},
    });

    expect(response.statusCode).toBe(403);
  });
});
