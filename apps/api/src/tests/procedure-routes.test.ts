import type { AuthenticatedUser, Role } from "@ooc/domain";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { buildApp } from "@/app.js";
import { container } from "@/container.js";
import { SESSION_COOKIE_NAME } from "@/infra/auth/betterAuth.js";

/**
 * CI gate §6.5 for paid procedures (OOC-83). The portal's routes are the
 * student's and nobody else's: staff settle money in Payments, they never act as
 * the student. A new price is `master`/`admin` only, like the settings it came
 * from. Everyone is refused before the handler runs, so no database is needed.
 */

const REQUEST = "018f2b5c-8300-7000-8000-000000000010";
const UPLOAD = "018f2b5c-8300-7000-8000-000000000011";

const PORTAL_ROUTES = [
  "/api/v1/portal/procedure-requests",
  `/api/v1/portal/procedure-requests/${REQUEST}/receipt-uploads`,
  `/api/v1/portal/procedure-requests/${REQUEST}/receipt-uploads/${UPLOAD}/confirm`,
  `/api/v1/portal/procedure-requests/${REQUEST}/payment`,
];

const STAFF: Role[] = ["master", "admin", "analyst", "enrollment_supervisor", "academic_supervisor", "teacher", "sales", "support", "billing"];
const PRICE_REFUSED: Role[] = ["analyst", "enrollment_supervisor", "academic_supervisor", "teacher", "sales", "support", "billing", "student"];

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

describe("the portal's procedure routes", () => {
  it.each(PORTAL_ROUTES.flatMap((url) => STAFF.map((role) => [url, role] as const)))("POST %s refuses %s", async (url, role) => {
    signInAs(role);
    expect((await post(url)).statusCode).toBe(403);
  });

  it.each(PORTAL_ROUTES)("POST %s refuses a request without a session", async (url) => {
    expect((await post(url, false)).statusCode).toBe(401);
  });
});

describe("procedure prices", () => {
  it.each(PRICE_REFUSED)("POST /procedure-prices refuses %s", async (role) => {
    signInAs(role);
    expect((await post("/api/v1/procedure-prices")).statusCode).toBe(403);
  });

  it("GET /procedure-prices refuses the student", async () => {
    signInAs("student");
    const response = await app.inject({ method: "GET", url: "/api/v1/procedure-prices", cookies: { [SESSION_COOKIE_NAME]: "token" } });
    expect(response.statusCode).toBe(403);
  });

  it("GET /procedure-prices refuses a request without a session", async () => {
    const response = await app.inject({ method: "GET", url: "/api/v1/procedure-prices" });
    expect(response.statusCode).toBe(401);
  });
});
