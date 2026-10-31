import {
  ConflictError,
  NotFoundError,
  ResendFailedEmailUseCase,
  UnableToProcessEntryError,
  deliveryFailureReason,
  isResendableTemplate,
  parseDeliveryDedupeKey,
  resendDedupeKey,
  type AuditLogEntry,
  type FailedDelivery,
  type IEmailDeliveryRepository,
} from "@ooc/domain";
import { describe, expect, it } from "vitest";

/**
 * The undelivered e-mails screen (OOC-90) without a database: what a failure
 * code means to a reader, which rows may be resent, and the resend's refusals.
 * The SQL side is `EmailDelivery.integration.test.ts`.
 */

describe("deliveryFailureReason", () => {
  it.each([
    ["template_render", "template_error"],
    ["brevo_http_400_invalid_parameter", "provider_refused"],
    ["brevo_http_401", "provider_refused"],
    ["brevo_http_429", "provider_unavailable"],
    ["brevo_http_503", "provider_unavailable"],
    ["brevo_network", "provider_unavailable"],
    ["unexpected", "provider_unavailable"],
    [null, "provider_unavailable"],
  ] as const)("%s → %s", (code, reason) => {
    expect(deliveryFailureReason(code)).toBe(reason);
  });
});

describe("parseDeliveryDedupeKey", () => {
  it("reads the subject and the recipient kind", () => {
    expect(parseDeliveryDedupeKey("payment_approved:p-1:guardian")).toEqual({ subjectId: "p-1", recipientKind: "guardian" });
    expect(parseDeliveryDedupeKey("enrollment_received:e-1:student")).toEqual({ subjectId: "e-1", recipientKind: "student" });
  });

  it("treats a portal key's token id as a student recipient", () => {
    expect(parseDeliveryDedupeKey("portal_credentials:usr_1:tok_9")).toEqual({ subjectId: "usr_1", recipientKind: "student" });
  });

  it("keeps the subject of a resend's key", () => {
    expect(parseDeliveryDedupeKey(resendDedupeKey("payment_rejected:p-2:guardian"))).toEqual({
      subjectId: "p-2",
      recipientKind: "guardian",
    });
  });
});

describe("isResendableTemplate", () => {
  it("resends the enrollment and payment e-mails, never one with a one-time link", () => {
    expect(isResendableTemplate("enrollment_received")).toBe(true);
    expect(isResendableTemplate("payment_rejected")).toBe(true);
    expect(isResendableTemplate("portal_credentials")).toBe(false);
    expect(isResendableTemplate("portal_password_reset")).toBe(false);
    expect(isResendableTemplate("email_verification_code")).toBe(false);
    expect(isResendableTemplate("staff_mfa_code")).toBe(false);
  });
});

class FakeDeliveries implements IEmailDeliveryRepository {
  resent: { dedupeKey: string; audit: AuditLogEntry }[] = [];
  conflict = false;

  constructor(private readonly row: FailedDelivery | null) {}

  async findDelivery() {
    return this.row;
  }

  async resend(params: Parameters<IEmailDeliveryRepository["resend"]>[0]) {
    if (this.conflict) return null;
    this.resent.push({ dedupeKey: params.dedupeKey, audit: params.audit("new-row") });
    return { outboxId: "new-row" };
  }
}

const FAILED: FailedDelivery = {
  id: "row-1",
  templateKey: "payment_approved",
  dedupeKey: "payment_approved:p-1:student",
  status: "failed",
  studentId: "stu-1",
};

describe("ResendFailedEmailUseCase", () => {
  it("writes the resend under a derived key and audits it without the address", async () => {
    const repo = new FakeDeliveries(FAILED);

    const result = await new ResendFailedEmailUseCase(repo).run({ actorId: "usr_admin", outboxId: "row-1" });

    expect(result).toEqual({ outboxId: "new-row" });
    expect(repo.resent).toHaveLength(1);
    expect(repo.resent[0]!.dedupeKey).toBe("payment_approved:p-1:student:resend");
    expect(repo.resent[0]!.audit).toMatchObject({
      actorId: "usr_admin",
      action: "email.resent",
      targetId: "row-1",
      metadata: { template: "payment_approved", resentAs: "new-row", studentId: "stu-1" },
    });
  });

  it("is 404 for a missing row and for a row the screen does not list", async () => {
    await expect(new ResendFailedEmailUseCase(new FakeDeliveries(null)).run({ actorId: "a", outboxId: "x" })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    const staff = new FakeDeliveries({ ...FAILED, templateKey: "staff_mfa_code" });
    await expect(new ResendFailedEmailUseCase(staff).run({ actorId: "a", outboxId: "x" })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("is 409 for a row that did not fail", async () => {
    const sent = new FakeDeliveries({ ...FAILED, status: "sent" });
    await expect(new ResendFailedEmailUseCase(sent).run({ actorId: "a", outboxId: "x" })).rejects.toMatchObject({
      reason: "email_delivery.not_failed",
    });
    expect(sent.resent).toHaveLength(0);
  });

  it("is 422 for an e-mail whose one-time link is gone", async () => {
    const portal = new FakeDeliveries({ ...FAILED, templateKey: "portal_credentials", dedupeKey: "portal_credentials:u:t" });
    await expect(new ResendFailedEmailUseCase(portal).run({ actorId: "a", outboxId: "x" })).rejects.toBeInstanceOf(
      UnableToProcessEntryError,
    );
  });

  it("is 409 when somebody resent it first", async () => {
    const repo = new FakeDeliveries(FAILED);
    repo.conflict = true;
    const error = await new ResendFailedEmailUseCase(repo).run({ actorId: "a", outboxId: "x" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConflictError);
    expect(error).toMatchObject({ reason: "email_delivery.already_resent" });
  });
});
