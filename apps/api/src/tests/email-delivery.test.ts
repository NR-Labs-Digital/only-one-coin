import {
  AllowlistGuard,
  BrevoNotificationProvider,
  EmailDeliveryError,
  RecipientNotAllowedError,
  type NotificationProvider,
  type OutgoingEmail,
} from "@ooc/notifications";
import { describe, expect, it, vi } from "vitest";
import type { IOutboxStore, OutboxEmailRow } from "@/infra/persistence/notification/DrizzleOutboxRepository.js";
import { deliverOutboxEmail } from "@/workers/deliverOutboxEmail.js";

/**
 * The delivery side of the outbox, with the network and the database faked:
 * the allowlist guard (CLAUDE.md §6, "e-mail real disparado de staging"), the
 * Brevo adapter's request and error classification, and what the worker writes
 * back to the row for each outcome.
 */

const AN_EMAIL: OutgoingEmail = {
  to: "rosa.quispe@gmail.com",
  templateKey: "payment_rejected",
  locale: "es-PE",
  vars: { recipientName: "Rosa", studentName: "Rosa Quispe", courseName: "Inglés Básico" },
};

class RecordingProvider implements NotificationProvider {
  sent: OutgoingEmail[] = [];
  async sendEmail(email: OutgoingEmail) {
    this.sent.push(email);
    return { providerId: "msg-1" };
  }
}

describe("AllowlistGuard", () => {
  it("lets everything through in production", async () => {
    const inner = new RecordingProvider();
    const guard = new AllowlistGuard(inner, { enforce: false, allowlist: [] });

    await guard.sendEmail(AN_EMAIL);
    expect(inner.sent).toHaveLength(1);
  });

  it("refuses every recipient outside production when the allowlist is empty", async () => {
    const inner = new RecordingProvider();
    const guard = new AllowlistGuard(inner, { enforce: true, allowlist: [] });

    await expect(guard.sendEmail(AN_EMAIL)).rejects.toBeInstanceOf(RecipientNotAllowedError);
    expect(inner.sent).toHaveLength(0);
  });

  it("matches exact addresses and whole domains, case-insensitively", () => {
    const guard = new AllowlistGuard(new RecordingProvider(), {
      enforce: true,
      allowlist: [" QA.Tester@gmail.com ", "@nrlabsdigital.com"],
    });

    expect(guard.allows("qa.tester@gmail.com")).toBe(true);
    expect(guard.allows("anyone@NRLabsDigital.com")).toBe(true);
    expect(guard.allows("rosa.quispe@gmail.com")).toBe(false);
    // A domain entry is the whole domain, not a suffix.
    expect(guard.allows("x@evil-nrlabsdigital.com")).toBe(false);
    expect(guard.allows("x@nrlabsdigital.com.evil.io")).toBe(false);
  });

  /* OOC-29: outside production the staff second-factor code for an address
     that is not a real inbox (the seeded admin@admin.com) goes to the
     allowlist instead — otherwise nobody can sign in as that account. */
  describe("the staff second-factor code outside production", () => {
    const MFA_EMAIL: OutgoingEmail = {
      to: "admin@admin.com",
      templateKey: "staff_mfa_code",
      locale: "es-PE",
      vars: { recipientName: "Admin", code: "042137" },
    };

    it("goes to every exact allowlisted address, never to the original recipient", async () => {
      const inner = new RecordingProvider();
      const guard = new AllowlistGuard(inner, {
        enforce: true,
        allowlist: ["qa.one@gmail.com", "@nrlabsdigital.com", "qa.two@gmail.com"],
      });

      await guard.sendEmail(MFA_EMAIL);

      expect(inner.sent.map((email) => email.to)).toEqual(["qa.one@gmail.com", "qa.two@gmail.com"]);
      expect(inner.sent.every((email) => email.templateKey === "staff_mfa_code")).toBe(true);
    });

    it("is sent as addressed when the recipient is already allowlisted", async () => {
      const inner = new RecordingProvider();
      const guard = new AllowlistGuard(inner, { enforce: true, allowlist: ["admin@admin.com", "qa.one@gmail.com"] });

      await guard.sendEmail(MFA_EMAIL);

      expect(inner.sent.map((email) => email.to)).toEqual(["admin@admin.com"]);
    });

    it("is refused when the allowlist names no exact address", async () => {
      const inner = new RecordingProvider();
      const guard = new AllowlistGuard(inner, { enforce: true, allowlist: ["@nrlabsdigital.com"] });

      await expect(guard.sendEmail(MFA_EMAIL)).rejects.toBeInstanceOf(RecipientNotAllowedError);
      expect(inner.sent).toHaveLength(0);
    });

    it("never redirects any other template", async () => {
      const inner = new RecordingProvider();
      const guard = new AllowlistGuard(inner, { enforce: true, allowlist: ["qa.one@gmail.com"] });

      await expect(guard.sendEmail(AN_EMAIL)).rejects.toBeInstanceOf(RecipientNotAllowedError);
      expect(inner.sent).toHaveLength(0);
    });
  });
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("BrevoNotificationProvider", () => {
  const config = { apiKey: "xkeysib-test", sender: { email: "avisos@onlyonecoin.edu.pe", name: "Only One Coin" } };

  it("posts the rendered e-mail to Brevo and returns its message id", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(jsonResponse(201, { messageId: "<abc@smtp>" }));
    const provider = new BrevoNotificationProvider({ ...config, fetch });

    await expect(provider.sendEmail(AN_EMAIL)).resolves.toEqual({ providerId: "<abc@smtp>" });

    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe("https://api.brevo.com/v3/smtp/email");
    expect((init!.headers as Record<string, string>)["api-key"]).toBe("xkeysib-test");
    const body = JSON.parse(init!.body as string);
    expect(body.to).toEqual([{ email: "rosa.quispe@gmail.com" }]);
    expect(body.sender).toEqual(config.sender);
    expect(body.subject).toContain("Rosa Quispe");
    expect(body.htmlContent).toContain("<html");
    expect(body.textContent.length).toBeGreaterThan(0);
    expect(body.tags).toEqual(["payment_rejected"]);
  });

  it("classifies 5xx and 429 as retryable, keeping only Brevo's error code", async () => {
    for (const status of [429, 500, 503]) {
      const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
        jsonResponse(status, { code: "too_many_requests", message: "rosa.quispe@gmail.com is rate limited" }),
      );
      const error = await new BrevoNotificationProvider({ ...config, fetch }).sendEmail(AN_EMAIL).catch((e) => e);

      expect(error).toBeInstanceOf(EmailDeliveryError);
      expect(error.retryable).toBe(true);
      expect(error.code).toBe(`brevo_http_${status}_too_many_requests`);
      expect(error.message).not.toContain("rosa.quispe");
    }
  });

  it("classifies other 4xx as permanent", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(jsonResponse(400, { code: "invalid_parameter" }));
    const error = await new BrevoNotificationProvider({ ...config, fetch }).sendEmail(AN_EMAIL).catch((e) => e);

    expect(error).toBeInstanceOf(EmailDeliveryError);
    expect(error.retryable).toBe(false);
    expect(error.code).toBe("brevo_http_400_invalid_parameter");
  });

  it("treats a network failure as retryable", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockRejectedValue(new TypeError("fetch failed"));
    const error = await new BrevoNotificationProvider({ ...config, fetch }).sendEmail(AN_EMAIL).catch((e) => e);

    expect(error).toBeInstanceOf(EmailDeliveryError);
    expect(error.retryable).toBe(true);
    expect(error.code).toBe("brevo_network");
  });
});

class FakeOutboxStore implements IOutboxStore {
  calls: string[] = [];
  constructor(public row: OutboxEmailRow | null) {}

  async listPendingIds() {
    return this.row?.status === "pending" ? [this.row.id] : [];
  }
  async findById() {
    return this.row;
  }
  async markSent(_id: string, providerMessageId: string) {
    this.calls.push(`sent:${providerMessageId}`);
  }
  async markBlocked() {
    this.calls.push("blocked");
  }
  async recordFailedAttempt(_id: string, errorCode: string, final: boolean) {
    this.calls.push(`attempt:${errorCode}:${final ? "final" : "retry"}`);
  }
}

function pendingRow(): OutboxEmailRow {
  return {
    id: "018f2b5c-2000-7000-8000-000000000001",
    templateKey: AN_EMAIL.templateKey,
    recipient: AN_EMAIL.to,
    locale: AN_EMAIL.locale,
    vars: AN_EMAIL.vars,
    status: "pending",
    attempts: 0,
  };
}

function failingWith(error: Error): NotificationProvider {
  return { sendEmail: () => Promise.reject(error) };
}

describe("deliverOutboxEmail", () => {
  it("sends a pending row and records the provider id", async () => {
    const store = new FakeOutboxStore(pendingRow());
    const provider = new RecordingProvider();

    await expect(deliverOutboxEmail("id", { store, provider, isFinalAttempt: false })).resolves.toBe("sent");
    expect(provider.sent[0]).toEqual(AN_EMAIL);
    expect(store.calls).toEqual(["sent:msg-1"]);
  });

  it("never sends a row twice", async () => {
    for (const status of ["sent", "blocked", "failed"] as const) {
      const store = new FakeOutboxStore({ ...pendingRow(), status });
      const provider = new RecordingProvider();

      await expect(deliverOutboxEmail("id", { store, provider, isFinalAttempt: false })).resolves.toBe("skipped");
      expect(provider.sent).toHaveLength(0);
    }
  });

  it("marks an allowlist refusal as blocked, without retrying", async () => {
    const store = new FakeOutboxStore(pendingRow());
    const provider = new AllowlistGuard(new RecordingProvider(), { enforce: true, allowlist: [] });

    await expect(deliverOutboxEmail("id", { store, provider, isFinalAttempt: false })).resolves.toBe("blocked");
    expect(store.calls).toEqual(["blocked"]);
  });

  it("gives up at once on a permanent provider error", async () => {
    const store = new FakeOutboxStore(pendingRow());
    const provider = failingWith(new EmailDeliveryError("brevo_http_400", false));

    await expect(deliverOutboxEmail("id", { store, provider, isFinalAttempt: false })).resolves.toBe("failed");
    expect(store.calls).toEqual(["attempt:brevo_http_400:final"]);
  });

  it("throws on a transient error so the queue retries, and fails the row on the last attempt", async () => {
    const transient = new EmailDeliveryError("brevo_http_503", true);

    const retrying = new FakeOutboxStore(pendingRow());
    await expect(
      deliverOutboxEmail("id", { store: retrying, provider: failingWith(transient), isFinalAttempt: false }),
    ).rejects.toBe(transient);
    expect(retrying.calls).toEqual(["attempt:brevo_http_503:retry"]);

    const last = new FakeOutboxStore(pendingRow());
    await expect(
      deliverOutboxEmail("id", { store: last, provider: failingWith(transient), isFinalAttempt: true }),
    ).resolves.toBe("failed");
    expect(last.calls).toEqual(["attempt:brevo_http_503:final"]);
  });
});
