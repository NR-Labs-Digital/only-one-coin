import { PUSH_EMAIL_KEYS, isAllowedPushEndpoint, isPushEmailKey, type AuthenticatedUser, type Role } from "@ooc/domain";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "@/app.js";
import { container } from "@/container.js";
import { SESSION_COOKIE_NAME } from "@/infra/auth/betterAuth.js";
import type {
  IPushOutboxStore,
  IPushSubscriptionStore,
  PushOutboxRow,
  PushOutcome,
  PushSubscriptionRow,
} from "@/infra/persistence/notification/DrizzlePushRepository.js";
import { PushDeliveryError, PushSubscriptionGoneError, type PushPayload, type PushSender } from "@/infra/push/WebPushSender.js";
import { deliverOutboxPush, type DeliverOutboxPushDeps } from "@/workers/deliverOutboxPush.js";

/**
 * Push notifications on the portal (OOC-51): which e-mails become a push,
 * which push services the API will call, the push worker with the database
 * and the network faked, and the portal routes with the repository stubbed.
 */

describe("which e-mails go out as a push", () => {
  it("pushes the steps of the student's journey", () => {
    for (const key of ["payment_approved", "grade_posted", "monthly_module_due", "certificate_issued", "lot_payment_rejected"]) {
      expect(isPushEmailKey(key)).toBe(true);
    }
  });

  it("never pushes security messages, the account opening, complaints or staff mail", () => {
    for (const key of [
      "portal_credentials",
      "portal_password_reset",
      "email_verification_code",
      "complaint_filed",
      "staff_mfa_code",
      "staff_invite",
      "class_access_ready", // not sent today
    ]) {
      expect(isPushEmailKey(key)).toBe(false);
    }
    expect(PUSH_EMAIL_KEYS.length).toBeGreaterThan(20);
  });
});

describe("isAllowedPushEndpoint", () => {
  it.each([
    "https://fcm.googleapis.com/fcm/send/abc:def",
    "https://updates.push.services.mozilla.com/wpush/v2/gAAAA",
    "https://web.push.apple.com/QGuQyavXutnMH",
    "https://wns2-par02p.notify.windows.com/w/?token=abc",
  ])("accepts the browsers' push service %s", (endpoint) => {
    expect(isAllowedPushEndpoint(endpoint)).toBe(true);
  });

  it.each([
    "http://fcm.googleapis.com/fcm/send/abc",
    "https://fcm.googleapis.com:8443/fcm/send/abc",
    "https://user:pw@fcm.googleapis.com/fcm/send/abc",
    "https://fcm.googleapis.com.evil.io/x",
    "https://evilpush.apple.com/x",
    "https://169.254.169.254/latest/meta-data",
    "https://localhost/x",
    "not a url",
  ])("refuses anything else: %s", (endpoint) => {
    expect(isAllowedPushEndpoint(endpoint)).toBe(false);
  });
});

/* ---------------------------------------------------------------- worker */

const ROW: PushOutboxRow = {
  id: "018f2b5c-0000-7000-8000-0000000000aa",
  templateKey: "payment_approved",
  recipient: "rosa.quispe@gmail.com",
  locale: "pt-BR",
  vars: {
    recipientName: "Rosa",
    studentName: "Rosa Quispe",
    courseName: "Inglés Básico",
    startsOn: "2026-12-01T05:00:00.000Z",
  },
};

const PHONE: PushSubscriptionRow = { endpoint: "https://fcm.googleapis.com/fcm/send/phone", p256dh: "k1", auth: "a1" };
const LAPTOP: PushSubscriptionRow = { endpoint: "https://web.push.apple.com/laptop", p256dh: "k2", auth: "a2" };

class FakeStore implements IPushOutboxStore {
  finished: PushOutcome[] = [];
  constructor(private row: PushOutboxRow | null) {}
  async listPendingPushIds() {
    return [];
  }
  async claimPush() {
    const row = this.row;
    this.row = null; // claimed once: a second run finds nothing
    return row;
  }
  async finishPush(_id: string, outcome: PushOutcome) {
    this.finished.push(outcome);
  }
}

class FakeSubscriptions implements IPushSubscriptionStore {
  forgotten: string[] = [];
  constructor(private readonly devices: PushSubscriptionRow[]) {}
  async listForRecipient() {
    return this.devices;
  }
  async forgetEndpoint(endpoint: string) {
    this.forgotten.push(endpoint);
  }
}

class FakeSender implements PushSender {
  sent: { endpoint: string; payload: PushPayload }[] = [];
  constructor(private readonly fail: Record<string, Error> = {}) {}
  async send(subscription: PushSubscriptionRow, payload: PushPayload) {
    const error = this.fail[subscription.endpoint];
    if (error) throw error;
    this.sent.push({ endpoint: subscription.endpoint, payload });
  }
}

function deps(overrides: Partial<DeliverOutboxPushDeps> & { row?: PushOutboxRow | null } = {}) {
  const store = new FakeStore(overrides.row === undefined ? ROW : overrides.row);
  const subscriptions = (overrides.subscriptions as FakeSubscriptions) ?? new FakeSubscriptions([PHONE, LAPTOP]);
  const sender = (overrides.sender as FakeSender) ?? new FakeSender();
  const all: DeliverOutboxPushDeps = {
    store,
    subscriptions,
    sender,
    wording: { findPublished: async () => null },
    allows: () => true,
    portalOrigin: "https://student.example.com",
    ...overrides,
  };
  return { all, store, subscriptions, sender };
}

describe("deliverOutboxPush", () => {
  it("pushes the e-mail's own subject and preheader to every device, in the row's language", async () => {
    const { all, store, sender } = deps();

    expect(await deliverOutboxPush(ROW.id, all)).toBe("sent");

    expect(sender.sent.map((s) => s.endpoint)).toEqual([PHONE.endpoint, LAPTOP.endpoint]);
    const { payload } = sender.sent[0];
    expect(payload.title).toContain("Inglés Básico");
    expect(payload.body.length).toBeGreaterThan(0);
    expect(payload.url).toBe("https://student.example.com/pt/portal");
    expect(payload.tag).toBe(ROW.id);
    expect(store.finished).toEqual(["sent"]);
  });

  it("uses the wording published in the backoffice, like the e-mail", async () => {
    const copy = { subject: "Pronto, {studentName}", preheader: "Aula em {courseName}", paragraphs: ["x"] };
    const { all, sender } = deps({
      wording: {
        findPublished: async () => ({ id: "v1", version: 1, content: { "es-PE": copy, "pt-BR": copy, en: copy } }),
      },
    });

    await deliverOutboxPush(ROW.id, all);

    expect(sender.sent[0].payload.title).toBe("Pronto, Rosa Quispe");
    expect(sender.sent[0].payload.body).toBe("Aula em Inglés Básico");
  });

  it("pushes at most once: a second run finds the row taken", async () => {
    const { all, sender } = deps();
    await deliverOutboxPush(ROW.id, all);
    expect(await deliverOutboxPush(ROW.id, all)).toBe("skipped");
    expect(sender.sent).toHaveLength(2);
  });

  it("ends as no_device when the account has none subscribed", async () => {
    const { all, store, sender } = deps({ subscriptions: new FakeSubscriptions([]) });
    expect(await deliverOutboxPush(ROW.id, all)).toBe("no_device");
    expect(sender.sent).toHaveLength(0);
    expect(store.finished).toEqual(["no_device"]);
  });

  it("is blocked outside production for a recipient off the allowlist, before reading any device", async () => {
    const subscriptions = new FakeSubscriptions([PHONE]);
    const list = vi.spyOn(subscriptions, "listForRecipient");
    const { all, store } = deps({ subscriptions, allows: () => false });
    expect(await deliverOutboxPush(ROW.id, all)).toBe("blocked");
    expect(list).not.toHaveBeenCalled();
    expect(store.finished).toEqual(["blocked"]);
  });

  it("forgets a device the push service no longer knows and still reaches the others", async () => {
    const sender = new FakeSender({ [PHONE.endpoint]: new PushSubscriptionGoneError() });
    const { all, subscriptions } = deps({ sender });
    expect(await deliverOutboxPush(ROW.id, all)).toBe("sent");
    expect((subscriptions as FakeSubscriptions).forgotten).toEqual([PHONE.endpoint]);
    expect(sender.sent.map((s) => s.endpoint)).toEqual([LAPTOP.endpoint]);
  });

  it("ends as no_device when every device is gone", async () => {
    const gone = new PushSubscriptionGoneError();
    const sender = new FakeSender({ [PHONE.endpoint]: gone, [LAPTOP.endpoint]: gone });
    const { all } = deps({ sender });
    expect(await deliverOutboxPush(ROW.id, all)).toBe("no_device");
  });

  it("fails, without retrying, when every device refuses — and reports only a code", async () => {
    const refused = new PushDeliveryError("push_http_500");
    const sender = new FakeSender({ [PHONE.endpoint]: refused, [LAPTOP.endpoint]: refused });
    const failures: unknown[] = [];
    const { all, store } = deps({ sender, onDeviceFailed: (info) => failures.push(info) });
    expect(await deliverOutboxPush(ROW.id, all)).toBe("failed");
    expect(store.finished).toEqual(["failed"]);
    expect(failures).toEqual([
      { outboxId: ROW.id, code: "push_http_500" },
      { outboxId: ROW.id, code: "push_http_500" },
    ]);
  });

  it("never pushes a template outside the push list, even if a row was marked", async () => {
    const { all, sender } = deps({ row: { ...ROW, templateKey: "portal_password_reset" } });
    expect(await deliverOutboxPush(ROW.id, all)).toBe("failed");
    expect(sender.sent).toHaveLength(0);
  });
});

/* ---------------------------------------------------------------- routes */

const SUBSCRIPTION = {
  endpoint: "https://fcm.googleapis.com/fcm/send/abc",
  keys: { p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM", auth: "tBHItJI5svbpez7KI4CCXg" },
};

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
  container.notifications.push.publicKey = null;
});

function as(role: Role) {
  const user: AuthenticatedUser = { id: "usr_51", email: "rosa.quispe@gmail.com", name: "Rosa", role, twoFactorEnabled: false };
  vi.spyOn(container.identity.currentSession, "resolve").mockResolvedValue(user);
}

function call(method: "GET" | "PUT" | "DELETE", url: string, payload?: unknown) {
  return app.inject({ method, url, cookies: { [SESSION_COOKIE_NAME]: "token" }, payload: payload as Record<string, unknown> });
}

describe("portal push routes", () => {
  it("says push is off when the platform has no VAPID keys", async () => {
    as("student");
    const response = await call("GET", "/api/v1/portal/push");
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ publicKey: null });
  });

  it("hands the public key out when push is on", async () => {
    as("student");
    container.notifications.push.publicKey = "BPublicKey";
    const response = await call("GET", "/api/v1/portal/push");
    expect(response.json()).toEqual({ publicKey: "BPublicKey" });
  });

  it("saves the device on the session's account", async () => {
    as("student");
    container.notifications.push.publicKey = "BPublicKey";
    const subscribe = vi.spyOn(container.notifications.push.repository, "subscribe").mockResolvedValue();
    const response = await call("PUT", "/api/v1/portal/push/subscription", { ...SUBSCRIPTION, userId: "someone-else" });
    expect(response.statusCode).toBe(204);
    expect(subscribe).toHaveBeenCalledWith("usr_51", {
      endpoint: SUBSCRIPTION.endpoint,
      p256dh: SUBSCRIPTION.keys.p256dh,
      auth: SUBSCRIPTION.keys.auth,
    });
  });

  it("refuses an endpoint that is not a browser push service (the API would POST to it)", async () => {
    as("student");
    container.notifications.push.publicKey = "BPublicKey";
    const subscribe = vi.spyOn(container.notifications.push.repository, "subscribe").mockResolvedValue();
    const response = await call("PUT", "/api/v1/portal/push/subscription", {
      ...SUBSCRIPTION,
      endpoint: "https://169.254.169.254/latest/meta-data",
    });
    expect(response.statusCode).toBe(422);
    expect(response.json().reason).toBe("push.endpoint_not_allowed");
    expect(subscribe).not.toHaveBeenCalled();
  });

  it("refuses to subscribe while push is off", async () => {
    as("student");
    const subscribe = vi.spyOn(container.notifications.push.repository, "subscribe").mockResolvedValue();
    const response = await call("PUT", "/api/v1/portal/push/subscription", SUBSCRIPTION);
    expect(response.statusCode).toBe(422);
    expect(response.json().reason).toBe("push.unavailable");
    expect(subscribe).not.toHaveBeenCalled();
  });

  it("forgets the device only on the session's account", async () => {
    as("student");
    const unsubscribe = vi.spyOn(container.notifications.push.repository, "unsubscribe").mockResolvedValue();
    const response = await call("DELETE", "/api/v1/portal/push/subscription", { endpoint: SUBSCRIPTION.endpoint });
    expect(response.statusCode).toBe(204);
    expect(unsubscribe).toHaveBeenCalledWith("usr_51", SUBSCRIPTION.endpoint);
  });

  it("refuses a request without a session", async () => {
    const response = await app.inject({ method: "GET", url: "/api/v1/portal/push" });
    expect(response.statusCode).toBe(401);
  });
});
