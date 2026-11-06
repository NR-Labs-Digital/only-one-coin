import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EmailVerificationCodeInvalidError,
  EmailVerificationCooldownError,
  SeatHoldExpiredError,
} from "@ooc/domain";
import { buildApp } from "@/app.js";
import { container } from "@/container.js";

/** The two public verification routes, no database: use cases and captcha stubbed. */

let app: FastifyInstance;
beforeAll(async () => {
  app = await buildApp();
});
afterAll(async () => {
  await app.close();
});
beforeEach(() => {
  vi.spyOn(container.edge.rateLimiter, "hit").mockResolvedValue(null);
});
afterEach(() => {
  vi.restoreAllMocks();
});

const HOLD = "018f2b5c-8000-7000-8000-000000000001";
const SEND = { holdId: HOLD, email: " Rosa.Quispe@GMAIL.com ", recipientName: "Rosa", locale: "es-PE", captchaToken: "t" };
const send = (payload: object) =>
  app.inject({ method: "POST", url: "/api/v1/enrollments/email-verifications", payload });
const confirm = (payload: object) =>
  app.inject({ method: "POST", url: "/api/v1/enrollments/email-verifications/confirm", payload });

describe("POST /enrollments/email-verifications", () => {
  it("checks the captcha, normalizes the address and answers 202 with the resend delay", async () => {
    vi.spyOn(container.edge.captcha, "verify").mockResolvedValue("passed");
    const run = vi.spyOn(container.useCases.enrollment.sendEmailVerification, "run").mockResolvedValue({ resendAfterSeconds: 60 });

    const response = await send(SEND);

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ resendAfterSeconds: 60 });
    expect(run).toHaveBeenCalledWith({ seatHoldId: HOLD, email: "rosa.quispe@gmail.com", recipientName: "Rosa", locale: "es-PE" });
  });

  it("refuses a failed captcha before sending anything", async () => {
    vi.spyOn(container.edge.captcha, "verify").mockResolvedValue("failed");
    const run = vi.spyOn(container.useCases.enrollment.sendEmailVerification, "run");

    const response = await send(SEND);

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ reason: "captcha.failed" });
    expect(run).not.toHaveBeenCalled();
  });

  it("fails closed when the captcha cannot be checked", async () => {
    vi.spyOn(container.edge.captcha, "verify").mockResolvedValue("unavailable");
    expect((await send(SEND)).statusCode).toBe(503);
  });

  it.each([
    ["not a Gmail", "rosa@hotmail.com", "email_must_be_gmail"],
    ["an impossible Gmail username", "rosa+x@gmail.com", "email_gmail_username_invalid"],
  ])("refuses %s as a field error", async (_label, email, code) => {
    const verify = vi.spyOn(container.edge.captcha, "verify");
    const response = await send({ ...SEND, email });

    expect(response.statusCode).toBe(400);
    expect(response.json().fields).toEqual(expect.arrayContaining([{ path: "email", code }]));
    expect(verify).not.toHaveBeenCalled();
  });

  it("answers the cooldown as 429 with its own reason", async () => {
    vi.spyOn(container.edge.captcha, "verify").mockResolvedValue("passed");
    vi.spyOn(container.useCases.enrollment.sendEmailVerification, "run").mockRejectedValue(new EmailVerificationCooldownError());

    const response = await send(SEND);

    expect(response.statusCode).toBe(429);
    expect(response.json()).toMatchObject({ reason: "email_verification.cooldown" });
  });

  it("answers an expired seat hold as 422 with its own reason", async () => {
    vi.spyOn(container.edge.captcha, "verify").mockResolvedValue("passed");
    vi.spyOn(container.useCases.enrollment.sendEmailVerification, "run").mockRejectedValue(new SeatHoldExpiredError());

    const response = await send(SEND);

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ reason: "enrollment.seat_hold_expired" });
  });
});

describe("POST /enrollments/email-verifications/confirm", () => {
  it("answers a right code with 200", async () => {
    const run = vi.spyOn(container.useCases.enrollment.confirmEmailVerification, "run").mockResolvedValue();

    const response = await confirm({ holdId: HOLD, email: "Rosa.Quispe@gmail.com", code: "042137" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ verified: true });
    expect(run).toHaveBeenCalledWith({ seatHoldId: HOLD, email: "rosa.quispe@gmail.com", code: "042137" });
  });

  it("refuses a code that is not six digits without calling the use case", async () => {
    const run = vi.spyOn(container.useCases.enrollment.confirmEmailVerification, "run");
    expect((await confirm({ holdId: HOLD, email: "rosa.quispe@gmail.com", code: "12ab" })).statusCode).toBe(400);
    expect(run).not.toHaveBeenCalled();
  });

  it("passes a wrong code through as 422 with its reason", async () => {
    vi.spyOn(container.useCases.enrollment.confirmEmailVerification, "run").mockRejectedValue(new EmailVerificationCodeInvalidError());
    const response = await confirm({ holdId: HOLD, email: "rosa.quispe@gmail.com", code: "000000" });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ reason: "email_verification.code_invalid" });
  });
});
