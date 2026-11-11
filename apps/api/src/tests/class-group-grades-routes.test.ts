import type { AuthenticatedUser, Role } from "@ooc/domain";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { buildApp } from "@/app.js";
import { container } from "@/container.js";
import { SESSION_COOKIE_NAME } from "@/infra/auth/betterAuth.js";
import { GRADE_READ_ROLES, GRADE_WRITE_ROLES } from "@/http/teaching/gradeRoles.js";

/**
 * The academic supervision's grades over HTTP (OOC-102). CI gate §6.5: every
 * cargo outside the role lists is refused, the analyst reads and never
 * writes, and an allowed cargo reaches the usecase with the session's account
 * as the actor — never an id from the request. No database: the usecases are
 * stubbed; what they do is `teaching-grades.test.ts`.
 */

const ID = "018f2b5c-1020-7000-8000-000000000001";
const SEAT = "018f2b5c-1020-7000-8000-0000000000e1";
const ACCOUNT = "usr_ooc102";

const EVERY_ROLE: Role[] = [
  "master",
  "admin",
  "analyst",
  "enrollment_supervisor",
  "academic_supervisor",
  "teacher",
  "sales",
  "support",
  "billing",
  "student",
];

const readers = new Set<Role>(GRADE_READ_ROLES);
const writers = new Set<Role>(GRADE_WRITE_ROLES);

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

function signIn(role: Role): void {
  const user: AuthenticatedUser = { id: ACCOUNT, email: "rosa@example.com", name: "Rosa", role, twoFactorEnabled: true };
  vi.spyOn(container.identity.currentSession, "resolve").mockResolvedValue(user);
}

function call(method: "GET" | "POST", url: string, payload?: unknown) {
  return app.inject({ method, url, cookies: { [SESSION_COOKIE_NAME]: "token" }, payload: payload as object });
}

const sheet = () => call("GET", `/api/v1/catalog/class-groups/${ID}/grades`);
const post = () =>
  call("POST", `/api/v1/catalog/class-groups/${ID}/grades`, { entries: [{ enrollmentId: SEAT, grade: 15 }] });
const correct = (body: unknown = { grade: 14.5, reason: "Error de digitación" }) =>
  call("POST", `/api/v1/catalog/class-groups/${ID}/grades/${SEAT}/correction`, body);

describe("who reads a class group's grades", () => {
  it("is exactly the supervision, management and the analyst", () => {
    expect([...readers].sort()).toEqual(["academic_supervisor", "admin", "analyst", "master"]);
    expect([...writers].sort()).toEqual(["academic_supervisor", "admin", "master"]);
  });

  it.each(EVERY_ROLE.filter((role) => !readers.has(role)))("refuses %s", async (role) => {
    signIn(role);
    expect((await sheet()).statusCode).toBe(403);
  });
});

describe("who posts and corrects", () => {
  it.each(EVERY_ROLE.filter((role) => !writers.has(role)))("refuses %s, the analyst included", async (role) => {
    signIn(role);
    const run = vi.spyOn(container.useCases.teaching.correctClassGroupGrade, "run");
    expect((await post()).statusCode).toBe(403);
    expect((await correct()).statusCode).toBe(403);
    expect(run).not.toHaveBeenCalled();
  });

  it.each([...writers])("lets %s correct, as the session's account", async (role) => {
    signIn(role);
    const run = vi
      .spyOn(container.useCases.teaching.correctClassGroupGrade, "run")
      .mockResolvedValue({ correctionId: "018f2b5c-1020-7000-8000-0000000000c1" });

    const response = await correct({ grade: "da", reason: "No rindió el examen" });

    expect(response.statusCode).toBe(201);
    expect(run).toHaveBeenCalledWith({
      actorId: ACCOUNT,
      classGroupId: ID,
      enrollmentId: SEAT,
      value: { kind: "did_not_sit" },
      reason: "No rindió el examen",
    });
  });

  it("lets the supervision post, as the session's account", async () => {
    signIn("academic_supervisor");
    const run = vi
      .spyOn(container.useCases.teaching.recordClassGroupGrades, "run")
      .mockResolvedValue({ recorded: 1, alreadyRecorded: 0, finished: true });

    const response = await post();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ recorded: 1, alreadyRecorded: 0, finished: true });
    expect(run).toHaveBeenCalledWith({
      actorId: ACCOUNT,
      classGroupId: ID,
      entries: [{ enrollmentId: SEAT, value: { kind: "score", score: 15 } }],
    });
  });

  it("refuses a correction above 20 or without a reason field before the usecase runs", async () => {
    signIn("academic_supervisor");
    const run = vi.spyOn(container.useCases.teaching.correctClassGroupGrade, "run");
    expect((await correct({ grade: 21, reason: "x" })).statusCode).toBe(400);
    expect((await correct({ grade: 14 })).statusCode).toBe(400);
    expect(run).not.toHaveBeenCalled();
  });
});

describe("the analyst reads", () => {
  it("gets the sheet", async () => {
    signIn("analyst");
    vi.spyOn(container.useCases.teaching.listClassGroupGrades, "run").mockResolvedValue({
      status: "finished",
      seats: [
        {
          enrollmentId: SEAT,
          firstName: "Rosa",
          lastName: "Quispe",
          grade: {
            enrollmentId: SEAT,
            value: { kind: "score", score: 14.5 },
            recordedAt: new Date("2026-11-10T15:00:00.000Z"),
            correctedAt: new Date("2026-11-10T16:00:00.000Z"),
            history: [
              { value: { kind: "score", score: 11 }, at: new Date("2026-11-10T15:00:00.000Z"), byName: "Ana", reason: null },
              {
                value: { kind: "score", score: 14.5 },
                at: new Date("2026-11-10T16:00:00.000Z"),
                byName: "Lucía",
                reason: "Error de digitación",
              },
            ],
          },
        },
      ],
    });

    const response = await sheet();

    expect(response.statusCode).toBe(200);
    expect(response.json().seats[0]).toMatchObject({
      firstName: "Rosa",
      grade: {
        grade: 14.5,
        didNotSit: false,
        correctedAt: "2026-11-10T16:00:00.000Z",
        history: [
          { grade: 11, byName: "Ana", reason: null },
          { grade: 14.5, byName: "Lucía", reason: "Error de digitación" },
        ],
      },
    });
  });
});
