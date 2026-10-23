import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "@/app.js";

/**
 * CI gate §6.5 for the second-factor routes (OOC-29): every staff cargo may
 * call them, so the case to refuse is no session at all. No database — the
 * authorization hook answers before the handler runs. The catch-all part
 * checks that Better Auth's own management endpoints stay closed: left open,
 * `/two-factor/disable` would let master/admin/billing drop the factor.
 */

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
});

describe("second-factor routes refuse a request without a session", () => {
  it.each([
    ["GET", "/api/v1/me/mfa", undefined],
    ["POST", "/api/v1/me/mfa/enrollment", { locale: "es-PE" }],
    ["POST", "/api/v1/me/mfa/enrollment/confirm", { code: "123456" }],
    ["POST", "/api/v1/me/mfa/recovery-codes", { password: "x" }],
    ["POST", "/api/v1/me/mfa/disable", { password: "x" }],
  ])("%s %s → 401", async (method, url, payload) => {
    const response = await app.inject({ method: method as "GET", url, payload });
    expect(response.statusCode).toBe(401);
  });
});

describe("Better Auth's own second-factor management stays closed", () => {
  it.each([
    "/api/auth/two-factor/enable",
    "/api/auth/two-factor/disable",
    "/api/auth/two-factor/generate-backup-codes",
    "/api/auth/two-factor/get-totp-uri",
    "/api/auth/two-factor/verify-totp",
  ])("POST %s → 404", async (url) => {
    const response = await app.inject({ method: "POST", url, payload: { password: "x" } });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ reason: "auth.endpoint_closed" });
  });
});
