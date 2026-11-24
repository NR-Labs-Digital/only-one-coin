import type { AuthenticatedUser, Role } from "@ooc/domain";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { buildApp } from "@/app.js";
import { container } from "@/container.js";
import { SESSION_COOKIE_NAME } from "@/infra/auth/betterAuth.js";

/**
 * CI gate §6.5 for monthly modules bought from the portal (OOC-86). The routes
 * are the student's and nobody else's: staff settle money in Payments and never
 * act as the student. Everyone is refused before the handler runs, so no
 * database is needed.
 */

const ENROLLMENT = "018f2b5c-8600-7000-8000-000000000010";
const UPLOAD = "018f2b5c-8600-7000-8000-000000000011";

const ROUTES = [
  `/api/v1/portal/enrollments/${ENROLLMENT}/monthly-receipt-uploads`,
  `/api/v1/portal/enrollments/${ENROLLMENT}/monthly-receipt-uploads/${UPLOAD}/confirm`,
  `/api/v1/portal/enrollments/${ENROLLMENT}/monthly-payment`,
];

const STAFF: Role[] = ["master", "admin", "analyst", "enrollment_supervisor", "academic_supervisor", "academic_assistant", "teacher", "sales", "support", "billing"];

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

const post = (url: string, session = true) =>
  app.inject({ method: "POST", url, payload: {}, ...(session ? { cookies: { [SESSION_COOKIE_NAME]: "token" } } : {}) });

describe("the portal's monthly routes", () => {
  it.each(ROUTES.flatMap((url) => STAFF.map((role) => [url, role] as const)))("POST %s refuses %s", async (url, role) => {
    signInAs(role);
    expect((await post(url)).statusCode).toBe(403);
  });

  it.each(ROUTES)("POST %s refuses a request without a session", async (url) => {
    expect((await post(url, false)).statusCode).toBe(401);
  });
});

describe("a class group's monthly seats", () => {
  // The roster's readers: billing settles money in Payments and sees no class
  // group, the teacher reads their own runs in /teaching, the student their portal.
  it.each(["billing", "teacher", "student"] as Role[])("GET refuses %s", async (role) => {
    signInAs(role);
    const response = await app.inject({
      method: "GET",
      url: `/api/v1/catalog/class-groups/${ENROLLMENT}/monthly`,
      cookies: { [SESSION_COOKIE_NAME]: "token" },
    });
    expect(response.statusCode).toBe(403);
  });

  it("GET refuses a request without a session", async () => {
    const response = await app.inject({ method: "GET", url: `/api/v1/catalog/class-groups/${ENROLLMENT}/monthly` });
    expect(response.statusCode).toBe(401);
  });
});
