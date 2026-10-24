import type { AuthenticatedUser, Role } from "@ooc/domain";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildApp } from "@/app.js";
import { container } from "@/container.js";
import { SESSION_COOKIE_NAME } from "@/infra/auth/betterAuth.js";

/**
 * CI gate §6.5 for the teacher file (OOC-78): every teacher route answers 403
 * to a cargo it did not declare. Reading is management, academic supervision
 * and the analyst; editing drops the analyst; registering is management only.
 * The handler never runs, so no database is needed.
 */

const ID = "018f2b5c-0000-7000-8000-000000000001";

const NEVER: Role[] = ["support", "sales", "billing", "enrollment_supervisor", "teacher"];

const CASES: [string, string, Role[]][] = [
  ["GET", "/api/v1/teachers", NEVER],
  // A teacher reads their own file only — the session check, not the role, refuses the rest (OOC-79).
  ["GET", `/api/v1/teachers/${ID}`, NEVER.filter((role) => role !== "teacher")],
  ["PUT", `/api/v1/teachers/${ID}`, [...NEVER, "analyst"]],
  ["PUT", `/api/v1/teachers/${ID}/availability`, [...NEVER, "analyst"]],
  ["PUT", `/api/v1/teachers/${ID}/status`, [...NEVER, "analyst"]],
  ["POST", "/api/v1/teachers", [...NEVER, "analyst", "academic_supervisor"]],
  // Contracts (OOC-124): generating records one, so it is an edit; opening a
  // filed one or printing a recorded one again is a read, not for the teacher.
  ["POST", `/api/v1/teachers/${ID}/contract-document`, [...NEVER, "analyst"]],
  ["GET", `/api/v1/teachers/${ID}/contracts/${ID}/file`, NEVER],
  ["GET", `/api/v1/teachers/${ID}/contracts/${ID}/document`, NEVER],
];

const FLAT = CASES.flatMap(([method, url, refused]) => refused.map((role) => [method, url, role] as const));

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
});

describe("teacher routes refuse undeclared roles", () => {
  it.each(FLAT)("%s %s refuses %s", async (method, url, role) => {
    const user: AuthenticatedUser = { id: "u1", email: "x@example.com", name: "X", role, twoFactorEnabled: true };
    vi.spyOn(container.identity.currentSession, "resolve").mockResolvedValue(user);

    const response = await app.inject({
      method: method as "GET",
      url,
      cookies: { [SESSION_COOKIE_NAME]: "token" },
      payload: method === "GET" ? undefined : {},
    });

    expect(response.statusCode).toBe(403);
  });
});
