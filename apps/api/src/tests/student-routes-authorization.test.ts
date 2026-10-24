import type { AuthenticatedUser, Role } from "@ooc/domain";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildApp } from "@/app.js";
import { container } from "@/container.js";
import { SESSION_COOKIE_NAME } from "@/infra/auth/betterAuth.js";

/**
 * CI gate §6.5 for the student file: every student route answers 403 to a
 * cargo it did not declare. Only management and enrollment supervision read
 * and correct a file (OOC-74) — `support` included among the refused. The
 * handler never runs, so no database is needed.
 */

const ID = "018f2b5c-0000-7000-8000-000000000001";

const ROUTES: [string, string][] = [
  ["GET", "/api/v1/students"],
  ["GET", "/api/v1/students/export"],
  ["GET", "/api/v1/students/search?q=ro"],
  ["POST", "/api/v1/students"],
  ["GET", `/api/v1/students/${ID}`],
  ["PUT", `/api/v1/students/${ID}`],
  ["PUT", `/api/v1/students/${ID}/guardian`],
  ["GET", `/api/v1/students/${ID}/activity`],
];

const REFUSED: Role[] = ["support", "sales", "billing", "analyst", "academic_supervisor", "teacher"];

const CASES = ROUTES.flatMap(([method, url]) => REFUSED.map((role) => [method, url, role] as const));

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
});

describe("student routes refuse undeclared roles", () => {
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
