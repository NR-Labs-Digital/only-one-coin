import type { AuthenticatedUser } from "@ooc/domain";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildApp } from "@/app.js";
import { container } from "@/container.js";
import { SESSION_COOKIE_NAME } from "@/infra/auth/betterAuth.js";

/**
 * OOC-64: the two routes that write a person refuse what the browser would
 * have refused, and say which field and why — a code, which the client
 * translates. No database: the body schema answers before the handler runs.
 */

const A_STUDENT = {
  firstName: "Rosa",
  lastName: "Quispe",
  nationalIdType: "DNI",
  nationalId: "70123456",
  email: "rosa.quispe@gmail.com",
  phone: "987654321",
  birthDate: "1996-04-12",
  country: "PE",
  region: "Lima",
  city: "Chorrillos",
};

const A_GUARDIAN = {
  firstName: "Ana",
  lastName: "Quispe",
  relationship: "mother",
  nationalIdType: "DNI",
  nationalId: "40123456",
  email: "ana@hotmail.com",
  phone: "987654321",
};

const PUBLIC_BODY = {
  holdId: "018f2b5c-5000-7000-8000-000000000001",
  receiptUploadId: "018f2b5c-5000-7000-8000-000000000002",
  classGroupId: "018f2b5c-5000-7000-8000-000000000003",
  planId: "018f2b5c-5000-7000-8000-000000000004",
  student: A_STUDENT,
  guardian: null,
  locale: "es-PE",
  payment: {
    method: "yape",
    methodDetail: null,
    operationNumber: "12345678",
    idempotencyKey: "018f2b5c-5000-7000-8000-000000000005",
  },
};

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
});

describe("POST /enrollments/public refuses invalid fields", () => {
  it.each([
    ["document out of format", { student: { ...A_STUDENT, nationalId: "1234" } }, "student.nationalId", "national_id_format"],
    ["short phone", { student: { ...A_STUDENT, phone: "12345" } }, "student.phone", "phone_format"],
    ["non-Gmail student", { student: { ...A_STUDENT, email: "rosa@colegio.edu.pe" } }, "student.email", "email_must_be_gmail"],
    ["name over the limit", { student: { ...A_STUDENT, firstName: "a".repeat(81) } }, "student.firstName", "too_long"],
    ["guardian document", { guardian: { ...A_GUARDIAN, nationalId: "40", consentAccepted: true } }, "guardian.nationalId", "national_id_format"],
    ["operation number", { payment: { ...PUBLIC_BODY.payment, operationNumber: "123" } }, "payment.operationNumber", "operation_format"],
    ["method detail over the limit", { payment: { ...PUBLIC_BODY.payment, method: "other", methodDetail: "x".repeat(81) } }, "payment.methodDetail", "too_long"],
  ])("%s", async (_label, patch, path, code) => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/enrollments/public",
      payload: { ...PUBLIC_BODY, ...patch },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json<{ reason: string; fields: { path: string; code: string }[] }>();
    expect(body.reason).toBe("validation_error");
    expect(body.fields).toContainEqual({ path, code });
  });
});

describe("POST /students refuses invalid fields", () => {
  it("names each field and its code", async () => {
    const user: AuthenticatedUser = { id: "u1", email: "x@example.com", name: "X", role: "admin", twoFactorEnabled: true };
    vi.spyOn(container.identity.currentSession, "resolve").mockResolvedValue(user);

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/students",
      cookies: { [SESSION_COOKIE_NAME]: "token" },
      payload: {
        student: { ...A_STUDENT, nationalIdType: "CE", phone: "+51 1", city: " " },
        guardian: null,
      },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json<{ fields: { path: string; code: string }[] }>();
    expect(body.fields).toEqual(
      expect.arrayContaining([
        { path: "student.phone", code: "phone_format" },
        { path: "student.city", code: "required" },
      ]),
    );
  });

  it("does not hold the backoffice to the checkout's Gmail gate (OOC-65 decides)", async () => {
    const user: AuthenticatedUser = { id: "u1", email: "x@example.com", name: "X", role: "admin", twoFactorEnabled: true };
    vi.spyOn(container.identity.currentSession, "resolve").mockResolvedValue(user);
    const run = vi
      .spyOn(container.useCases.student.register, "run")
      .mockRejectedValue(new Error("stop before the database"));

    await app.inject({
      method: "POST",
      url: "/api/v1/students",
      cookies: { [SESSION_COOKIE_NAME]: "token" },
      payload: { student: { ...A_STUDENT, email: "Rosa@Colegio.edu.pe", nationalId: "70.123.456" }, guardian: null },
    });

    // Reached the usecase, with the values already normalized.
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({
        student: expect.objectContaining({ email: "rosa@colegio.edu.pe", nationalId: "70123456" }),
      }),
    );
  });
});
