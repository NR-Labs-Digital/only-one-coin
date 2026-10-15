import type { AuthenticatedUser, Role } from "@ooc/domain";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "@/app.js";
import { container } from "@/container.js";
import { SESSION_COOKIE_NAME } from "@/infra/auth/betterAuth.js";

/** CI gate §6.5 for the portal routes behind a session. */

const STUDENT_ID = "018f2b5c-0000-7000-8000-000000000001";
const PAYMENT_ID = "018f2b5c-0000-7000-8000-000000000002";

const CASES: [string, string, Role][] = [
  ["GET", "/api/v1/portal/me", "admin"],
  ["GET", "/api/v1/portal/me", "guardian"],
  ["GET", "/api/v1/portal/me", "master"],
  ["GET", "/api/v1/portal/overview", "admin"],
  ["GET", "/api/v1/portal/overview", "guardian"],
  ["GET", "/api/v1/portal/overview", "billing"],
  ["GET", `/api/v1/portal/payments/${PAYMENT_ID}/receipt`, "admin"],
  ["GET", `/api/v1/portal/payments/${PAYMENT_ID}/receipt`, "billing"],
  ["GET", `/api/v1/portal/payments/${PAYMENT_ID}/receipt`, "guardian"],
  ["POST", `/api/v1/students/${STUDENT_ID}/portal-access`, "billing"],
  ["POST", `/api/v1/students/${STUDENT_ID}/portal-access`, "analyst"],
  ["POST", `/api/v1/students/${STUDENT_ID}/portal-access`, "sales"],
  ["POST", `/api/v1/students/${STUDENT_ID}/portal-access`, "teacher"],
  ["POST", `/api/v1/students/${STUDENT_ID}/portal-access`, "student"],
  ["GET", `/api/v1/me`, "student"],
];

let app: FastifyInstance;
beforeAll(async () => {
  app = await buildApp();
});
afterAll(async () => {
  await app.close();
});
beforeEach(() => {
  // Keep a local Redis from carrying counters between runs (fail-open stub).
  vi.spyOn(container.edge.rateLimiter, "hit").mockResolvedValue(null);
});
afterEach(() => {
  vi.restoreAllMocks();
});

function as(role: Role) {
  const user: AuthenticatedUser = { id: "u1", email: "x@example.com", name: "X", role, twoFactorEnabled: true };
  vi.spyOn(container.identity.currentSession, "resolve").mockResolvedValue(user);
}

describe("portal routes refuse undeclared roles", () => {
  it.each(CASES)("%s %s refuses %s", async (method, url, role) => {
    as(role);
    const response = await app.inject({
      method: method as "GET",
      url,
      cookies: { [SESSION_COOKIE_NAME]: "token" },
      payload: method === "GET" ? undefined : {},
    });
    expect(response.statusCode).toBe(403);
  });

  it("refuses /portal/me without a session", async () => {
    const response = await app.inject({ method: "GET", url: "/api/v1/portal/me" });
    expect(response.statusCode).toBe(401);
  });

  it("answers a student account with no file behind it with 403", async () => {
    as("student");
    vi.spyOn(container.repositories.portalAccess, "findIdentity").mockResolvedValue(null);
    const response = await app.inject({ method: "GET", url: "/api/v1/portal/me", cookies: { [SESSION_COOKIE_NAME]: "token" } });
    expect(response.statusCode).toBe(403);
  });

  it("gives a student their own identity", async () => {
    as("student");
    vi.spyOn(container.repositories.portalAccess, "findIdentity").mockResolvedValue({ firstName: "Ana", lastName: "Quispe", email: "ana@gmail.com" });
    const response = await app.inject({ method: "GET", url: "/api/v1/portal/me", cookies: { [SESSION_COOKIE_NAME]: "token" } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ firstName: "Ana", lastName: "Quispe", email: "ana@gmail.com" });
  });

  it("answers /portal/overview with 403 for a student account with no file behind it", async () => {
    as("student");
    vi.spyOn(container.queries.studentPortal, "overview").mockResolvedValue(null);
    const response = await app.inject({ method: "GET", url: "/api/v1/portal/overview", cookies: { [SESSION_COOKIE_NAME]: "token" } });
    expect(response.statusCode).toBe(403);
  });

  it("reads the overview off the session's account, never an id from the client", async () => {
    as("student");
    const overview = vi.spyOn(container.queries.studentPortal, "overview").mockResolvedValue(null);
    await app.inject({ method: "GET", url: "/api/v1/portal/overview?userId=someone-else", cookies: { [SESSION_COOKIE_NAME]: "token" } });
    expect(overview).toHaveBeenCalledWith("u1");
  });

  it("answers someone else's receipt like a missing one, without minting a URL", async () => {
    as("student");
    vi.spyOn(container.queries.studentPortal, "ownsPayment").mockResolvedValue(false);
    const mint = vi.spyOn(container.queries.paymentReceiptImage, "run");
    const response = await app.inject({
      method: "GET",
      url: `/api/v1/portal/payments/${PAYMENT_ID}/receipt`,
      cookies: { [SESSION_COOKIE_NAME]: "token" },
    });
    expect(response.statusCode).toBe(404);
    expect(mint).not.toHaveBeenCalled();
  });

  it("gives a student their own receipt, audited as the student", async () => {
    as("student");
    vi.spyOn(container.queries.studentPortal, "ownsPayment").mockResolvedValue(true);
    const mint = vi
      .spyOn(container.queries.paymentReceiptImage, "run")
      .mockResolvedValue({ url: "https://bucket.example.com/r.jpg", expiresAt: new Date("2026-10-07T12:05:00.000Z") });
    const response = await app.inject({
      method: "GET",
      url: `/api/v1/portal/payments/${PAYMENT_ID}/receipt`,
      cookies: { [SESSION_COOKIE_NAME]: "token" },
    });
    expect(response.statusCode).toBe(200);
    expect(mint).toHaveBeenCalledWith({ paymentId: PAYMENT_ID, actorId: "u1" });
  });
});
