import type { AuthenticatedUser, Role } from "@ooc/domain";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildApp } from "@/app.js";
import { container } from "@/container.js";
import { SESSION_COOKIE_NAME } from "@/infra/auth/betterAuth.js";

/**
 * CI gate §6.5 for the owners' backups (OOC-153): the e-mail domain opens the
 * door, never the cargo — an `admin` of the institution is refused like any
 * other account outside the owners' domains. No database: the authorization
 * hook answers before the handler runs.
 */

const ROUTES: [string, string][] = [
  ["GET", "/api/v1/platform/backups"],
  ["POST", "/api/v1/platform/backup-restores"],
  ["POST", "/api/v1/platform/backup-restores/0195f1d2-0000-7000-8000-000000000000/discard"],
];
const ROLES: Role[] = ["admin", "analyst", "billing", "enrollment_supervisor", "academic_supervisor", "teacher", "student"];

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
});

describe("backup routes are the owners' alone", () => {
  for (const [method, url] of ROUTES) {
    it.each(ROLES)(`${method} ${url} refuses %s outside the owners' domain`, async (role) => {
      const user: AuthenticatedUser = { id: "u1", email: "x@onlyonecoin.edu.pe", name: "X", role, twoFactorEnabled: true };
      vi.spyOn(container.identity.currentSession, "resolve").mockResolvedValue(user);

      const response = await app.inject({
        method: method as "GET",
        url,
        cookies: { [SESSION_COOKIE_NAME]: "token" },
        payload: method === "GET" ? undefined : { backupKey: "x", confirmation: "x" },
      });

      expect(response.statusCode).toBe(403);
    });

    it(`${method} ${url} refuses without a session`, async () => {
      vi.spyOn(container.identity.currentSession, "resolve").mockResolvedValue(null);
      const response = await app.inject({ method: method as "GET", url });
      expect(response.statusCode).toBe(401);
    });
  }
});
