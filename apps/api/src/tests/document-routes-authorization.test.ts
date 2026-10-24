import type { AuthenticatedUser, Role } from "@ooc/domain";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildApp } from "@/app.js";
import { container } from "@/container.js";
import { SESSION_COOKIE_NAME } from "@/infra/auth/betterAuth.js";

/**
 * CI gate §6.5 for document templates (OOC-123): only management edits,
 * previews and publishes a document's text (decision of 23/10/2026). The
 * handler never runs, so no database or WeasyPrint is needed.
 */

const NEVER: Role[] = [
  "analyst",
  "enrollment_supervisor",
  "academic_supervisor",
  "teacher",
  "sales",
  "support",
  "billing",
];

const CASES: [string, string][] = [
  ["GET", "/api/v1/document-templates/teacher_contract"],
  ["PUT", "/api/v1/document-templates/teacher_contract/draft"],
  ["POST", "/api/v1/document-templates/teacher_contract/preview"],
  ["POST", "/api/v1/document-templates/teacher_contract/publish"],
];

const FLAT = CASES.flatMap(([method, url]) => NEVER.map((role) => [method, url, role] as const));

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
});

describe("document template routes refuse undeclared roles", () => {
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
