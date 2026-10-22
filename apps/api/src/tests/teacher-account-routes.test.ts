import { Teacher, type AuthenticatedUser, type Role } from "@ooc/domain";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { buildApp } from "@/app.js";
import { container } from "@/container.js";
import { SESSION_COOKIE_NAME } from "@/infra/auth/betterAuth.js";

/**
 * OOC-79 over HTTP: `/me` answers the teacher file the account belongs to,
 * the invite form's teacher picker is management only (CI gate §6.5), and the
 * invite body keeps a teacher file off any other cargo. No database: the
 * session and the reads behind the handlers are stubbed.
 */

const TEACHER_ID = "018f2b5c-0000-7000-8000-000000000079";

const REFUSED: Role[] = [
  "analyst",
  "enrollment_supervisor",
  "academic_supervisor",
  "teacher",
  "sales",
  "support",
  "billing",
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
  const user: AuthenticatedUser = { id: "usr_79", email: "ana@example.com", name: "Ana Quispe", role, twoFactorEnabled: true };
  vi.spyOn(container.identity.currentSession, "resolve").mockResolvedValue(user);
}

function teacherFile(): Teacher {
  return new Teacher({
    ...Teacher.create({
      firstName: "Ana",
      lastName: "Quispe",
      nationalIdType: "DNI",
      nationalId: "12345678",
      email: "ana@example.com",
      phone: "+51900000000",
      nationality: "IT",
      country: "PE",
      region: "Lima",
      city: "Lima",
      addressLine: "Av. Siempre Viva 123",
      languages: ["Italiano"],
      availability: [],
    }),
    id: TEACHER_ID,
    userId: "usr_79",
  });
}

describe("GET /me", () => {
  it("answers the teacher file linked to a teacher account", async () => {
    signIn("teacher");
    const lookup = vi.spyOn(container.repositories.teacher, "findByUserId").mockResolvedValue(teacherFile());

    const response = await app.inject({ method: "GET", url: "/api/v1/me", cookies: { [SESSION_COOKIE_NAME]: "token" } });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ role: "teacher", teacherId: TEACHER_ID });
    expect(lookup).toHaveBeenCalledWith("usr_79");
  });

  it("answers null for a teacher account linked to no file", async () => {
    signIn("teacher");
    vi.spyOn(container.repositories.teacher, "findByUserId").mockResolvedValue(null);

    const response = await app.inject({ method: "GET", url: "/api/v1/me", cookies: { [SESSION_COOKIE_NAME]: "token" } });

    expect(response.json()).toMatchObject({ teacherId: null });
  });

  it("does not look for a file behind another cargo", async () => {
    signIn("support");
    const lookup = vi.spyOn(container.repositories.teacher, "findByUserId");

    const response = await app.inject({ method: "GET", url: "/api/v1/me", cookies: { [SESSION_COOKIE_NAME]: "token" } });

    expect(response.json()).toMatchObject({ teacherId: null });
    expect(lookup).not.toHaveBeenCalled();
  });
});

describe("GET /teachers/:teacherId as a teacher", () => {
  const OTHER_ID = "018f2b5c-0000-7000-8000-000000000080";

  it("reads the teacher's own file", async () => {
    signIn("teacher");
    vi.spyOn(container.repositories.teacher, "findByUserId").mockResolvedValue(teacherFile());
    const read = vi.spyOn(container.queries.getTeacher, "run").mockResolvedValue(null);

    await app.inject({ method: "GET", url: `/api/v1/teachers/${TEACHER_ID}`, cookies: { [SESSION_COOKIE_NAME]: "token" } });

    expect(read).toHaveBeenCalledWith(TEACHER_ID);
  });

  it("answers 404 for another teacher's file, without reading it", async () => {
    signIn("teacher");
    vi.spyOn(container.repositories.teacher, "findByUserId").mockResolvedValue(teacherFile());
    const read = vi.spyOn(container.queries.getTeacher, "run");

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/teachers/${OTHER_ID}`,
      cookies: { [SESSION_COOKIE_NAME]: "token" },
    });

    expect(response.statusCode).toBe(404);
    expect(read).not.toHaveBeenCalled();
  });

  it("answers 404 to a teacher account linked to no file", async () => {
    signIn("teacher");
    vi.spyOn(container.repositories.teacher, "findByUserId").mockResolvedValue(null);
    const read = vi.spyOn(container.queries.getTeacher, "run");

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/teachers/${TEACHER_ID}`,
      cookies: { [SESSION_COOKIE_NAME]: "token" },
    });

    expect(response.statusCode).toBe(404);
    expect(read).not.toHaveBeenCalled();
  });
});

describe("GET /staff/invites/teacher-options", () => {
  it.each(REFUSED)("refuses %s", async (role) => {
    signIn(role);

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/staff/invites/teacher-options",
      cookies: { [SESSION_COOKIE_NAME]: "token" },
    });

    expect(response.statusCode).toBe(403);
  });

  it("lists the files that can still receive an account", async () => {
    signIn("admin");
    vi.spyOn(container.queries.listInvitableTeachers, "run").mockResolvedValue([
      { id: TEACHER_ID, firstName: "Ana", lastName: "Quispe", email: "ana@example.com" },
    ]);

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/staff/invites/teacher-options",
      cookies: { [SESSION_COOKIE_NAME]: "token" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      items: [{ id: TEACHER_ID, firstName: "Ana", lastName: "Quispe", email: "ana@example.com" }],
    });
  });
});

describe("POST /staff/invites", () => {
  it("refuses a teacher file on an invite for another cargo", async () => {
    signIn("admin");
    const create = vi.spyOn(container.useCases.staff.createInvite, "run");

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/staff/invites",
      cookies: { [SESSION_COOKIE_NAME]: "token" },
      payload: { firstName: "Ana", lastName: "Quispe", email: "ana@example.com", role: "support", teacherId: TEACHER_ID },
    });

    expect(response.statusCode).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  it("passes the teacher file of a teacher invite to the usecase", async () => {
    signIn("admin");
    const create = vi.spyOn(container.useCases.staff.createInvite, "run").mockResolvedValue({
      invite: {
        id: "inv_1",
        email: "ana@example.com",
        firstName: "Ana",
        lastName: "Quispe",
        role: "teacher",
        token: "tok",
        status: "pending",
        teacherId: TEACHER_ID,
        expiresAt: new Date(),
      },
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/staff/invites",
      cookies: { [SESSION_COOKIE_NAME]: "token" },
      payload: { firstName: "Ana", lastName: "Quispe", email: "ana@example.com", role: "teacher", teacherId: TEACHER_ID },
    });

    expect(response.statusCode).toBe(201);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ role: "teacher", teacherId: TEACHER_ID }));
  });
});
