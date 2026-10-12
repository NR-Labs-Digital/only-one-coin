import type { AuthenticatedUser } from "@ooc/domain";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { buildApp } from "@/app.js";
import { container } from "@/container.js";
import { SESSION_COOKIE_NAME } from "@/infra/auth/betterAuth.js";
import type { StudentDetailRow } from "@/infra/persistence/student/GetStudentQuery.js";

/**
 * OOC-109: the birth date is a calendar date, stored as UTC midnight. Sent as
 * an instant, the student file read it in America/Lima and printed the day
 * before. The route hands it over as `YYYY-MM-DD`. No database: the queries
 * are stubbed.
 */

const ID = "018f2b5c-0000-7000-8000-000000000001";

const STUDENT: StudentDetailRow = {
  id: ID,
  firstName: "Rosa",
  lastName: "Quispe",
  nationalIdType: "DNI",
  nationalId: "70123456",
  email: "rosa.quispe@gmail.com",
  phone: "987654321",
  birthDate: new Date("1996-04-12T00:00:00.000Z"),
  country: "PE",
  region: "Lima",
  city: "Chorrillos",
  createdAt: new Date("2026-09-01T15:00:00.000Z"),
  isMinor: false,
  status: "active",
  activeCourses: 1,
  totalEnrollments: 1,
  lastActivityAt: new Date("2026-09-01T15:00:00.000Z"),
  guardian: null,
};

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

describe("GET /students/:id", () => {
  it("sends the birth date as the calendar date it was written on", async () => {
    const user: AuthenticatedUser = { id: "u1", email: "x@example.com", name: "X", role: "admin" };
    vi.spyOn(container.identity.currentSession, "resolve").mockResolvedValue(user);
    vi.spyOn(container.edge.rateLimiter, "hit").mockResolvedValue(null);
    vi.spyOn(container.queries.getStudent, "run").mockResolvedValue(STUDENT);
    vi.spyOn(container.queries.studentEnrollmentHistory, "run").mockResolvedValue([]);
    vi.spyOn(container.repositories.portalAccess, "accessState").mockResolvedValue("none");

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/students/${ID}`,
      cookies: { [SESSION_COOKIE_NAME]: "token" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<{ birthDate: string }>().birthDate).toBe("1996-04-12");
  });
});
