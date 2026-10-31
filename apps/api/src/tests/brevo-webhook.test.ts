import { classifyBounceReason, normalizeProviderMessageId, parseBrevoEvent } from "@ooc/notifications";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "@/app.js";
import { container } from "@/container.js";
import { webhookTokenMatches } from "@/infra/edge/BrevoWebhookAuth.js";

/**
 * OOC-91: Brevo's webhook — what it is parsed into, who may call it, and what
 * the route does with the answer. No database: the recorder is stubbed (the
 * SQL is `DrizzleEmailDeliveryRepository.integration.test.ts`).
 */

const TOKEN = "t".repeat(40);
const MESSAGE_ID = "<202610310101.12345678901@smtp-relay.mailin.fr>";

const hardBounce = {
  event: "hard_bounce",
  email: "rosa.quispe@gmail.com",
  "message-id": MESSAGE_ID,
  reason: "550 5.1.1 The email account that you tried to reach does not exist",
  ts_epoch: 1_793_400_000_000,
  ts_event: 1_793_400_000,
};

describe("parseBrevoEvent", () => {
  it("reduces a hard bounce to the closed vocabulary, keeping neither the address nor the text", () => {
    const parsed = parseBrevoEvent(hardBounce);

    expect(parsed).toEqual({
      kind: "event",
      event: {
        messageId: "202610310101.12345678901@smtp-relay.mailin.fr",
        kind: "hard_bounce",
        reason: "address_unknown",
        occurredAt: new Date(1_793_400_000_000),
        dedupeKey: "202610310101.12345678901@smtp-relay.mailin.fr:hard_bounce:1793400000000",
      },
    });
    expect(JSON.stringify(parsed)).not.toContain("rosa.quispe");
    expect(JSON.stringify(parsed)).not.toContain("does not exist");
  });

  it("gives the same event the same dedupe key — that is what makes a Brevo retry a no-op", () => {
    expect(parseBrevoEvent(hardBounce)).toEqual(parseBrevoEvent({ ...hardBounce }));
  });

  it("keeps a delivery without a reason", () => {
    const parsed = parseBrevoEvent({ event: "delivered", "message-id": MESSAGE_ID, ts_event: 1_793_400_000 });
    expect(parsed).toMatchObject({ kind: "event", event: { kind: "delivered", reason: null } });
  });

  it("reads ts_event as seconds when there is no ts_epoch", () => {
    const parsed = parseBrevoEvent({ event: "delivered", "message-id": MESSAGE_ID, ts_event: 1_793_400_000 });
    expect(parsed).toMatchObject({ event: { occurredAt: new Date(1_793_400_000_000) } });
  });

  it.each([
    ["invalid_email", "hard_bounce", "address_unknown"],
    ["blocked", "blocked", "blocked_by_server"],
    ["unsubscribed", "unsubscribed", null],
    ["soft_bounce", "soft_bounce", "other"],
  ])("maps %s", (event, kind, reason) => {
    const parsed = parseBrevoEvent({ event, "message-id": MESSAGE_ID, ts_epoch: 1 });
    expect(parsed).toMatchObject({ kind: "event", event: { kind, reason } });
  });

  it.each(["request", "deferred", "opened", "click", "unique_opened", "error"])("ignores %s", (event) => {
    expect(parseBrevoEvent({ event, "message-id": MESSAGE_ID, ts_epoch: 1 })).toEqual({ kind: "ignored" });
  });

  it.each([
    ["no message id", { event: "delivered", ts_epoch: 1 }],
    ["no instant — the dedupe key would change on every retry", { event: "delivered", "message-id": MESSAGE_ID }],
    ["not an event at all", { hello: "world" }],
  ])("refuses a body with %s", (_label, body) => {
    expect(parseBrevoEvent(body)).toBeNull();
  });
});

describe("classifyBounceReason", () => {
  it.each([
    ["452 4.2.2 The email account that you tried to reach is over quota", "mailbox_full"],
    ["Mailbox is full", "mailbox_full"],
    ["550 5.1.1 user unknown", "address_unknown"],
    ["unknown user at example.com", "address_unknown"],
    ["Domain not found", "domain_invalid"],
    ["550 message rejected as spam", "blocked_by_server"],
    ["server is down", "other"],
    [undefined, "other"],
  ])("%s → %s", (text, expected) => {
    expect(classifyBounceReason(text)).toBe(expected);
  });
});

describe("normalizeProviderMessageId", () => {
  it("drops the angle brackets Brevo puts on one side only", () => {
    expect(normalizeProviderMessageId("<abc@x>")).toBe("abc@x");
    expect(normalizeProviderMessageId("abc@x")).toBe("abc@x");
  });
});

describe("webhookTokenMatches", () => {
  it("accepts the exact bearer token", () => {
    expect(webhookTokenMatches(`Bearer ${TOKEN}`, TOKEN)).toBe(true);
  });

  it.each([
    ["no header", undefined],
    ["another scheme", `Basic ${TOKEN}`],
    ["a wrong token", `Bearer ${"x".repeat(40)}`],
    ["a prefix of the token", `Bearer ${TOKEN.slice(0, 20)}`],
    ["an empty token", "Bearer "],
  ])("refuses %s", (_label, header) => {
    expect(webhookTokenMatches(header, TOKEN)).toBe(false);
  });
});

describe("POST /webhooks/brevo", () => {
  let app: FastifyInstance;
  const configured = container.config.BREVO_WEBHOOK_TOKEN;

  beforeAll(async () => {
    app = await buildApp();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => {
    container.config.BREVO_WEBHOOK_TOKEN = TOKEN;
    vi.spyOn(container.edge.rateLimiter, "hit").mockResolvedValue(null);
  });
  afterEach(() => {
    container.config.BREVO_WEBHOOK_TOKEN = configured;
    vi.restoreAllMocks();
  });

  const call = (payload: object, authorization?: string) =>
    app.inject({
      method: "POST",
      url: "/api/v1/webhooks/brevo",
      payload,
      headers: authorization ? { authorization } : {},
    });

  it("refuses a call without a valid token and records nothing", async () => {
    const record = vi.spyOn(container.notifications.delivery, "record");

    expect((await call(hardBounce)).statusCode).toBe(401);
    expect((await call(hardBounce, "Bearer wrong")).statusCode).toBe(401);
    expect(record).not.toHaveBeenCalled();
  });

  it("refuses everything — closed, not open — when no token is configured", async () => {
    container.config.BREVO_WEBHOOK_TOKEN = undefined;
    const record = vi.spyOn(container.notifications.delivery, "record");

    const response = await call(hardBounce, `Bearer ${TOKEN}`);

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ reason: "webhook.unavailable" });
    expect(record).not.toHaveBeenCalled();
  });

  it("records a bounce and answers 200", async () => {
    const record = vi.spyOn(container.notifications.delivery, "record").mockResolvedValue({ kind: "recorded", studentsMarked: 1 });

    const response = await call(hardBounce, `Bearer ${TOKEN}`);

    expect(response.statusCode).toBe(200);
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ kind: "hard_bounce", reason: "address_unknown" }));
  });

  it.each([
    ["a duplicate", { kind: "duplicate" } as const],
    ["a message nobody here sent", { kind: "unknown_message" } as const],
  ])("answers 200 for %s — a retry would not make it interesting", async (_label, outcome) => {
    vi.spyOn(container.notifications.delivery, "record").mockResolvedValue(outcome);
    expect((await call(hardBounce, `Bearer ${TOKEN}`)).statusCode).toBe(200);
  });

  it("answers 200 and records nothing for an event the platform does not keep", async () => {
    const record = vi.spyOn(container.notifications.delivery, "record");

    const response = await call({ event: "opened", "message-id": MESSAGE_ID, ts_epoch: 1 }, `Bearer ${TOKEN}`);

    expect(response.statusCode).toBe(200);
    expect(record).not.toHaveBeenCalled();
  });

  it("answers 400 for an authenticated body that is not a usable event", async () => {
    const response = await call({ hello: "world" }, `Bearer ${TOKEN}`);
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ reason: "webhook.invalid_payload" });
  });
});
