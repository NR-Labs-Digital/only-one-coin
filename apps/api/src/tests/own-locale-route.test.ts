import type { AuthenticatedUser, Role } from "@ooc/domain";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "@/app.js";
import { container } from "@/container.js";
import { SESSION_COOKIE_NAME } from "@/infra/auth/betterAuth.js";

/**
 * `PUT /me/locale` (OOC-150): every signed-in account saves its own language,
 * always on the session's user — never an id from the client. No database:
 * the repository is stubbed.
 */

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
  const user: AuthenticatedUser = { id: "usr_150", email: "x@example.com", name: "X", role, twoFactorEnabled: true };
  vi.spyOn(container.identity.currentSession, "resolve").mockResolvedValue(user);
}

function put(payload: Record<string, unknown>) {
  return app.inject({ method: "PUT", url: "/api/v1/me/locale", cookies: { [SESSION_COOKIE_NAME]: "token" }, payload });
}

describe("PUT /me/locale", () => {
  it("refuses a request without a session", async () => {
    const response = await app.inject({ method: "PUT", url: "/api/v1/me/locale", payload: { locale: "en" } });
    expect(response.statusCode).toBe(401);
  });

  it("refuses a guardian account", async () => {
    as("guardian");
    const save = vi.spyOn(container.identity.userPreferenceRepository, "setPreferredLocale").mockResolvedValue();
    const response = await put({ locale: "en" });
    expect(response.statusCode).toBe(403);
    expect(save).not.toHaveBeenCalled();
  });

  it.each<Role>(["student", "teacher", "billing", "master"])("saves the language of a %s account", async (role) => {
    as(role);
    const save = vi.spyOn(container.identity.userPreferenceRepository, "setPreferredLocale").mockResolvedValue();
    const response = await put({ locale: "pt-BR" });
    expect(response.statusCode).toBe(204);
    expect(save).toHaveBeenCalledWith("usr_150", "pt-BR");
  });

  it("acts on the session's account, never an id from the body", async () => {
    as("student");
    const save = vi.spyOn(container.identity.userPreferenceRepository, "setPreferredLocale").mockResolvedValue();
    await put({ locale: "en", userId: "someone-else" });
    expect(save).toHaveBeenCalledWith("usr_150", "en");
  });

  it.each([{ locale: "qu" }, { locale: "es" }, {}])("refuses a language outside the three: %j", async (payload) => {
    as("student");
    const save = vi.spyOn(container.identity.userPreferenceRepository, "setPreferredLocale").mockResolvedValue();
    const response = await put(payload);
    expect(response.statusCode).toBe(400);
    expect(save).not.toHaveBeenCalled();
  });
});
