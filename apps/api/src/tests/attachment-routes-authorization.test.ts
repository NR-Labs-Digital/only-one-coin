import type { AuthenticatedUser, Role } from "@ooc/domain";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildApp } from "@/app.js";
import { container } from "@/container.js";
import { SESSION_COOKIE_NAME } from "@/infra/auth/betterAuth.js";

/**
 * CI gate §6.5 for attachments (OOC-143): the panel's routes answer 403 to every
 * cargo outside the student file's audience — and to a student — and the
 * portal's to every staff cargo. The handler never runs, so no database.
 */

const ID = "018f2b5c-0000-7000-8000-000000000001";

const STAFF_ROUTES: [string, string][] = [
  ["GET", `/api/v1/attachments?ownerType=student&ownerId=${ID}`],
  ["POST", "/api/v1/attachments/uploads"],
  ["POST", `/api/v1/attachments/${ID}/confirm`],
  ["GET", `/api/v1/attachments/${ID}/download`],
  ["DELETE", `/api/v1/attachments/${ID}`],
];

const PORTAL_ROUTES: [string, string][] = [
  ["GET", "/api/v1/portal/attachments"],
  ["POST", "/api/v1/portal/attachments/uploads"],
  ["POST", `/api/v1/portal/attachments/${ID}/confirm`],
  ["GET", `/api/v1/portal/attachments/${ID}/download`],
];

const STAFF_REFUSED: Role[] = ["support", "sales", "billing", "analyst", "academic_supervisor", "teacher", "student"];
const PORTAL_REFUSED: Role[] = ["master", "admin", "enrollment_supervisor", "support", "billing", "teacher"];

const CASES = [
  ...STAFF_ROUTES.flatMap(([method, url]) => STAFF_REFUSED.map((role) => [method, url, role] as const)),
  ...PORTAL_ROUTES.flatMap(([method, url]) => PORTAL_REFUSED.map((role) => [method, url, role] as const)),
];

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
});

describe("attachment routes refuse undeclared roles", () => {
  it.each(CASES)("%s %s refuses %s", async (method, url, role) => {
    const user: AuthenticatedUser = { id: "u1", email: "x@example.com", name: "X", role, twoFactorEnabled: true };
    vi.spyOn(container.identity.currentSession, "resolve").mockResolvedValue(user);

    const response = await app.inject({
      method: method as "GET",
      url,
      cookies: { [SESSION_COOKIE_NAME]: "token" },
      payload: method === "GET" || method === "DELETE" ? undefined : {},
    });

    expect(response.statusCode).toBe(403);
  });
});
