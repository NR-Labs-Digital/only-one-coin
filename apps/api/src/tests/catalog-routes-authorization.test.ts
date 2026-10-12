import type { AuthenticatedUser, Role } from "@ooc/domain";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildApp } from "@/app.js";
import { container } from "@/container.js";
import { SESSION_COOKIE_NAME } from "@/infra/auth/betterAuth.js";

/**
 * CI gate §6.5 for the catalog: every catalog route answers 403 to a role it
 * did not declare. The handler never runs (the authorization hook answers
 * first), so no database is needed.
 */

const ID = "018f2b5c-0000-7000-8000-000000000001";

/** [method, url, a role that must be refused] */
const CASES: [string, string, Role][] = [
  ["GET", "/api/v1/catalog/courses", "billing"],
  ["GET", "/api/v1/catalog/courses", "teacher"],
  ["GET", `/api/v1/catalog/courses/${ID}`, "billing"],
  ["POST", "/api/v1/catalog/courses", "enrollment_supervisor"],
  ["PATCH", `/api/v1/catalog/courses/${ID}`, "enrollment_supervisor"],
  ["PATCH", `/api/v1/catalog/courses/${ID}/options`, "analyst"],
  ["POST", `/api/v1/catalog/courses/${ID}/plans`, "enrollment_supervisor"],
  ["PATCH", `/api/v1/catalog/plans/${ID}`, "enrollment_supervisor"],
  ["POST", `/api/v1/catalog/plans/${ID}/prices`, "billing"],
  ["GET", "/api/v1/catalog/periods", "billing"],
  ["POST", "/api/v1/catalog/periods", "academic_supervisor"],
  ["PATCH", `/api/v1/catalog/periods/${ID}`, "sales"],
  ["POST", `/api/v1/catalog/periods/${ID}/duplicate`, "academic_supervisor"],
  ["GET", "/api/v1/catalog/class-groups", "teacher"],
  ["GET", `/api/v1/catalog/class-groups/${ID}`, "billing"],
  ["POST", "/api/v1/catalog/class-groups", "academic_supervisor"],
  ["PATCH", `/api/v1/catalog/class-groups/${ID}`, "support"],
  ["POST", `/api/v1/catalog/class-groups/${ID}/status`, "analyst"],
  ["GET", `/api/v1/catalog/class-groups/${ID}/waitlist`, "billing"],
  // The waitlist carries the national id: only who runs class groups reads it (same as GET /students).
  ["GET", `/api/v1/catalog/class-groups/${ID}/waitlist`, "sales"],
  ["GET", `/api/v1/catalog/class-groups/${ID}/waitlist`, "analyst"],
  ["POST", `/api/v1/catalog/class-groups/${ID}/waitlist`, "sales"],
  // The teacher picker (OOC-80) follows who opens class groups — reading the
  // directory is not enough, and the roster carries no contact.
  ["GET", "/api/v1/catalog/teacher-options", "analyst"],
  ["GET", "/api/v1/catalog/teacher-options", "academic_supervisor"],
  ["GET", "/api/v1/catalog/teacher-options", "teacher"],
  ["POST", `/api/v1/catalog/waitlist/${ID}/leave`, "support"],
];

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
});

describe("catalog routes refuse undeclared roles", () => {
  it.each(CASES)("%s %s refuses %s", async (method, url, role) => {
    const user: AuthenticatedUser = { id: "u1", email: "x@example.com", name: "X", role };
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
