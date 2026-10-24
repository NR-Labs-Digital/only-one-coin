import type { AuthenticatedUser } from "@ooc/domain";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { buildApp } from "@/app.js";
import { container } from "@/container.js";
import { SESSION_COOKIE_NAME } from "@/infra/auth/betterAuth.js";
import type { StudentListRow } from "@/infra/persistence/student/ListStudentsQuery.js";
import { RATE_LIMITS } from "@/shared/http/rateLimit.js";

/**
 * OOC-121: the directory export hands the directory's filters to the query,
 * streams one row per line and spends its own per-account counter on top of
 * the staff budget. No database: the query is stubbed.
 */

const ROW: StudentListRow = {
  id: "018f2b5c-0000-7000-8000-000000000001",
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
  totalEnrollments: 2,
  lastActivityAt: new Date("2026-09-02T15:00:00.000Z"),
};

async function* batches(...groups: StudentListRow[][]): AsyncGenerator<StudentListRow[]> {
  for (const group of groups) {
    await Promise.resolve();
    yield group;
  }
}

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

describe("GET /students/export", () => {
  it("streams every batch as NDJSON for the directory's filters, recorded under the caller", async () => {
    const user: AuthenticatedUser = { id: "u1", email: "x@example.com", name: "X", role: "enrollment_supervisor", twoFactorEnabled: true };
    vi.spyOn(container.identity.currentSession, "resolve").mockResolvedValue(user);
    const hit = vi.spyOn(container.edge.rateLimiter, "hit").mockResolvedValue(null);
    const exportDirectory = vi
      .spyOn(container.queries.listStudents, "exportDirectory")
      .mockResolvedValue({ rowCount: 3, batches: batches([ROW, { ...ROW, firstName: "Ana" }], [{ ...ROW, firstName: "Luz" }]) });

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/students/export?q=quispe&status=former&minor=true",
      cookies: { [SESSION_COOKIE_NAME]: "token" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("application/x-ndjson");
    expect(response.headers["x-row-count"]).toBe("3");
    expect(exportDirectory).toHaveBeenCalledWith({ q: "quispe", status: "former", minor: true, sort: "newest" }, "u1");

    const lines = response.body.trimEnd().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(lines.map((line) => line.firstName)).toEqual(["Rosa", "Ana", "Luz"]);
    expect(lines[0]).toMatchObject({ birthDate: "1996-04-12", nationalId: "70123456", email: "rosa.quispe@gmail.com" });

    const counters = hit.mock.calls.map(([key]) => key);
    expect(counters.some((key) => key.includes(`:rl:${RATE_LIMITS.studentExport.name}:`))).toBe(true);
    expect(counters.some((key) => key.includes(`:rl:${RATE_LIMITS.staff.name}:`))).toBe(true);
  });

  it("'all' exports every tab", async () => {
    const user: AuthenticatedUser = { id: "u1", email: "x@example.com", name: "X", role: "admin", twoFactorEnabled: true };
    vi.spyOn(container.identity.currentSession, "resolve").mockResolvedValue(user);
    vi.spyOn(container.edge.rateLimiter, "hit").mockResolvedValue(null);
    const exportDirectory = vi
      .spyOn(container.queries.listStudents, "exportDirectory")
      .mockResolvedValue({ rowCount: 0, batches: batches() });

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/students/export?status=all",
      cookies: { [SESSION_COOKIE_NAME]: "token" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe("");
    expect(exportDirectory).toHaveBeenCalledWith({ q: undefined, status: undefined, minor: false, sort: "newest" }, "u1");
  });
});
