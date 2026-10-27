import { Teacher, type AuthenticatedUser, type Role, type TeachingClassGroup } from "@ooc/domain";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { buildApp } from "@/app.js";
import { container } from "@/container.js";
import { SESSION_COOKIE_NAME } from "@/infra/auth/betterAuth.js";

/**
 * The docente portal over HTTP (OOC-82). CI gate §6.5 both ways: the
 * `/teaching` routes answer 403 to every cargo but `teacher`, and a teacher
 * gets 403 from Pagos and from every coordination route. Then the anti-IDOR
 * half: the id that reaches the usecase as "who" is the session's account,
 * and a class group id swapped in the URL is a 404. No database — the session
 * and the reads behind the usecases are stubbed; the same scope against a
 * real Postgres is `Teaching.integration.test.ts`.
 */

const A_ACCOUNT = "usr_ooc82_a";
const A_TEACHER = "018f2b5c-8200-7000-8000-0000000000a1";
const B_TEACHER = "018f2b5c-8200-7000-8000-0000000000b1";
const A_GROUP = "018f2b5c-8200-7000-8000-000000000011";
const B_GROUP = "018f2b5c-8200-7000-8000-000000000016";
const ID = "018f2b5c-0000-7000-8000-000000000001";

const STAFF: Role[] = [
  "master",
  "admin",
  "analyst",
  "enrollment_supervisor",
  "academic_supervisor",
  "sales",
  "support",
  "billing",
];

const TEACHING_ROUTES = [
  "/api/v1/teaching/class-groups",
  `/api/v1/teaching/class-groups/${ID}`,
  `/api/v1/teaching/class-groups/${ID}/students`,
  "/api/v1/teaching/summary",
];

/** Pagos and the coordination's screens — none of it is a teacher's door. */
const NOT_A_TEACHERS: [string, string][] = [
  ["GET", "/api/v1/payments"],
  ["GET", "/api/v1/payments/review"],
  ["GET", `/api/v1/payments/${ID}/receipt`],
  ["POST", `/api/v1/payments/${ID}/approve`],
  ["POST", `/api/v1/payments/${ID}/reject`],
  ["POST", `/api/v1/payments/${ID}/reread`],
  ["GET", "/api/v1/dashboard/summary"],
  ["GET", "/api/v1/enrollments"],
  ["POST", "/api/v1/enrollments"],
  ["GET", "/api/v1/students"],
  ["GET", "/api/v1/students/search"],
  ["GET", `/api/v1/students/${ID}`],
  ["GET", "/api/v1/catalog/class-groups"],
  ["GET", `/api/v1/catalog/class-groups/${ID}`],
  ["GET", `/api/v1/catalog/class-groups/${ID}/roster`],
  ["GET", `/api/v1/catalog/class-groups/${ID}/waitlist`],
  ["PATCH", `/api/v1/catalog/class-groups/${ID}`],
  ["POST", `/api/v1/catalog/class-groups/${ID}/status`],
  ["GET", "/api/v1/catalog/courses"],
  ["GET", "/api/v1/catalog/periods"],
  ["GET", "/api/v1/teachers"],
  ["GET", "/api/v1/staff"],
  ["PATCH", "/api/v1/settings"],
];

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
  const user: AuthenticatedUser = { id: A_ACCOUNT, email: "ana@example.com", name: "Ana Docente", role, twoFactorEnabled: true };
  vi.spyOn(container.identity.currentSession, "resolve").mockResolvedValue(user);
}

function inject(method: string, url: string) {
  return app.inject({
    method: method as "GET",
    url,
    cookies: { [SESSION_COOKIE_NAME]: "token" },
    payload: method === "GET" ? undefined : {},
  });
}

function teacherFile(id: string): Teacher {
  return new Teacher({
    ...Teacher.create({
      firstName: "Ana",
      lastName: "Docente",
      nationalIdType: "DNI",
      nationalId: "82234567",
      email: "ana@example.com",
      phone: "+51900000082",
      nationality: "PE",
      country: "PE",
      region: "Lima",
      city: "Lima",
      addressLine: "Av. Prueba 82",
      languages: ["Inglés"],
      availability: [],
    }),
    id,
    userId: A_ACCOUNT,
  });
}

function group(id: string, teacherId: string): TeachingClassGroup {
  return {
    id,
    teacherId,
    code: "ING-01",
    courseName: "Inglés Básico",
    language: "Inglés",
    academicPeriodName: "Ciclo 2026-II",
    slots: [{ weekday: "tue", startTime: "19:00", endTime: "20:30" }],
    startsOn: new Date("2026-10-01T05:00:00.000Z"),
    endsOn: new Date("2026-11-30T05:00:00.000Z"),
    capacity: 20,
    seatsTaken: 12,
    status: "in_progress",
    retired: false,
    classroomUrl: "https://classroom.google.com/c/ing01",
  };
}

describe("teaching routes refuse every cargo but teacher", () => {
  const flat = TEACHING_ROUTES.flatMap((url) => STAFF.map((role) => [url, role] as const));

  it.each(flat)("GET %s refuses %s", async (url, role) => {
    signIn(role);
    expect((await inject("GET", url)).statusCode).toBe(403);
  });
});

describe("a teacher is refused by Pagos and the coordination routes", () => {
  it.each(NOT_A_TEACHERS)("%s %s answers 403 to a teacher", async (method, url) => {
    signIn("teacher");
    expect((await inject(method, url)).statusCode).toBe(403);
  });
});

describe("the id in the URL is not proof of whose class group it is", () => {
  function asTeacherA(): void {
    signIn("teacher");
    vi.spyOn(container.repositories.teacher, "findByUserId").mockResolvedValue(teacherFile(A_TEACHER));
  }

  it("asks for the teacher behind the session's account, never one from the request", async () => {
    asTeacherA();
    const lookup = vi.spyOn(container.repositories.teacher, "findByUserId");
    const list = vi.spyOn(container.repositories.teaching, "listClassGroupsOf").mockResolvedValue([group(A_GROUP, A_TEACHER)]);

    const response = await inject("GET", `/api/v1/teaching/class-groups?teacherId=${B_TEACHER}`);

    expect(response.statusCode).toBe(200);
    expect(lookup).toHaveBeenCalledWith(A_ACCOUNT);
    expect(list).toHaveBeenCalledWith(A_TEACHER);
  });

  it("answers 404 when teacher A swaps in teacher B's class group id", async () => {
    asTeacherA();
    // The read answers B's class group as it is: what refuses it has to be the
    // usecase's comparison with the session, not a filter in the SQL.
    vi.spyOn(container.repositories.teaching, "findClassGroup").mockResolvedValue(group(B_GROUP, B_TEACHER));

    const response = await inject("GET", `/api/v1/teaching/class-groups/${B_GROUP}`);

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ reason: "catalog.class_group_not_found" });
  });

  it("answers 404 for teacher B's students, without reading a single one", async () => {
    asTeacherA();
    vi.spyOn(container.repositories.teaching, "findClassGroup").mockResolvedValue(group(B_GROUP, B_TEACHER));
    const students = vi.spyOn(container.repositories.teaching, "listStudents");

    const response = await inject("GET", `/api/v1/teaching/class-groups/${B_GROUP}/students`);

    expect(response.statusCode).toBe(404);
    expect(students).not.toHaveBeenCalled();
  });

  it("serves the own class group without the teacher id", async () => {
    asTeacherA();
    vi.spyOn(container.repositories.teaching, "findClassGroup").mockResolvedValue(group(A_GROUP, A_TEACHER));

    const response = await inject("GET", `/api/v1/teaching/class-groups/${A_GROUP}`);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ id: A_GROUP, code: "ING-01", startsOn: "2026-10-01T05:00:00.000Z" });
    expect(response.json()).not.toHaveProperty("teacherId");
  });

  it("serves the own class group's Classroom link (OOC-98)", async () => {
    asTeacherA();
    vi.spyOn(container.repositories.teaching, "findClassGroup").mockResolvedValue(group(A_GROUP, A_TEACHER));

    const response = await inject("GET", `/api/v1/teaching/class-groups/${A_GROUP}`);

    expect(response.json()).toMatchObject({ classroomUrl: "https://classroom.google.com/c/ing01" });
  });

  it("serves the own students as one name each", async () => {
    asTeacherA();
    vi.spyOn(container.repositories.teaching, "findClassGroup").mockResolvedValue(group(A_GROUP, A_TEACHER));
    vi.spyOn(container.repositories.teaching, "listStudents").mockResolvedValue([
      { enrollmentId: ID, firstName: "Lucía", lastName: "Zapata" },
    ]);

    const response = await inject("GET", `/api/v1/teaching/class-groups/${A_GROUP}/students`);

    expect(response.json()).toEqual({ items: [{ enrollmentId: ID, studentName: "Lucía Zapata" }] });
  });
});

/**
 * No active course is a state of the portal, not a refusal (OOC-101): the
 * teacher still signs in and is answered an empty list and a zeroed summary,
 * which the home reads as "No tienes cursos activos".
 */
describe("a teacher with no active class group gets an empty portal", () => {
  const EMPTY_SUMMARY = { teaching: 0, inPortal: 0, students: 0 };

  it("answers an empty list and a zeroed summary when nothing is allocated", async () => {
    signIn("teacher");
    vi.spyOn(container.repositories.teacher, "findByUserId").mockResolvedValue(teacherFile(A_TEACHER));
    vi.spyOn(container.repositories.teaching, "listClassGroupsOf").mockResolvedValue([]);
    const count = vi.spyOn(container.repositories.teaching, "countStudents");

    const list = await inject("GET", "/api/v1/teaching/class-groups");
    const summary = await inject("GET", "/api/v1/teaching/summary");

    expect(list.statusCode).toBe(200);
    expect(list.json()).toEqual({ items: [] });
    expect(summary.statusCode).toBe(200);
    expect(summary.json()).toEqual(EMPTY_SUMMARY);
    expect(count).not.toHaveBeenCalled();
  });

  it("leaves out the class groups coordination closed or still drafts", async () => {
    signIn("teacher");
    vi.spyOn(container.repositories.teacher, "findByUserId").mockResolvedValue(teacherFile(A_TEACHER));
    vi.spyOn(container.repositories.teaching, "listClassGroupsOf").mockResolvedValue([
      { ...group(A_GROUP, A_TEACHER), status: "closed" },
      { ...group(ID, A_TEACHER), status: "draft" },
    ]);

    expect((await inject("GET", "/api/v1/teaching/class-groups")).json()).toEqual({ items: [] });
    expect((await inject("GET", "/api/v1/teaching/summary")).json()).toEqual(EMPTY_SUMMARY);
  });

  it("answers the same to an account linked to no file, without a read for a null id", async () => {
    signIn("teacher");
    vi.spyOn(container.repositories.teacher, "findByUserId").mockResolvedValue(null);
    const list = vi.spyOn(container.repositories.teaching, "listClassGroupsOf");

    expect((await inject("GET", "/api/v1/teaching/class-groups")).json()).toEqual({ items: [] });
    expect((await inject("GET", "/api/v1/teaching/summary")).json()).toEqual(EMPTY_SUMMARY);
    expect(list).not.toHaveBeenCalled();
  });
});
