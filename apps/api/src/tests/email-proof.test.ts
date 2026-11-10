import { SendEmailProofUseCase, type EmailProofMessage, type IEmailProofRepository } from "@ooc/domain";
import { renderEmail, type OutgoingEmail } from "@ooc/notifications";
import { describe, expect, it } from "vitest";
import { EMAIL_PREVIEW_SAMPLES } from "@/http/email/emailPreviewSamples.js";

/**
 * OOC-89: a proof of an automatic e-mail — the rule (up to five distinct
 * addresses, one new message each, the audit entry without the addresses) and
 * the marked subject the worker sends it with.
 */

class RecordingProofs implements IEmailProofRepository {
  messages: EmailProofMessage[] = [];
  audit: ReturnType<Parameters<IEmailProofRepository["send"]>[0]["audit"]> | null = null;

  async send(params: Parameters<IEmailProofRepository["send"]>[0]) {
    this.messages = params.messages;
    const outboxIds = params.messages.map((_, index) => `o-${index}`);
    this.audit = params.audit(outboxIds);
    return { outboxIds };
  }
}

const INPUT = {
  actorId: "u-1",
  templateKey: "payment_approved" as const,
  locale: "es-PE" as const,
  vars: EMAIL_PREVIEW_SAMPLES.payment_approved as Record<string, unknown>,
};

describe("SendEmailProofUseCase", () => {
  it("writes one message per address, normalized, with a key no other send shares", async () => {
    const proofs = new RecordingProofs();
    const useCase = new SendEmailProofUseCase(proofs);

    await useCase.run({ ...INPUT, recipients: [" QA.One@OnlyOneCoin.edu.pe ", "qa.two@onlyonecoin.edu.pe"] });
    const first = proofs.messages.map((message) => message.dedupeKey);
    await useCase.run({ ...INPUT, recipients: ["qa.one@onlyonecoin.edu.pe", "qa.two@onlyonecoin.edu.pe"] });

    expect(proofs.messages.map((message) => message.to)).toEqual([
      "qa.one@onlyonecoin.edu.pe",
      "qa.two@onlyonecoin.edu.pe",
    ]);
    expect(proofs.messages.every((message) => message.vars === INPUT.vars && message.locale === "es-PE")).toBe(true);
    expect(new Set([...first, ...proofs.messages.map((message) => message.dedupeKey)]).size).toBe(4);
  });

  it("audits who, which template and how many — never the addresses", async () => {
    const proofs = new RecordingProofs();

    await new SendEmailProofUseCase(proofs).run({ ...INPUT, recipients: ["qa.one@onlyonecoin.edu.pe"] });

    expect(proofs.audit).toMatchObject({
      actorId: "u-1",
      action: "email.proof_sent",
      metadata: { template: "payment_approved", locale: "es-PE", recipients: 1, outboxIds: ["o-0"] },
    });
    expect(JSON.stringify(proofs.audit)).not.toContain("qa.one");
  });

  it.each([
    ["no address", [], "email_proof.no_recipients"],
    ["six addresses", ["a@x.pe", "b@x.pe", "c@x.pe", "d@x.pe", "e@x.pe", "f@x.pe"], "email_proof.too_many_recipients"],
    ["something that is not an address", ["qa.one"], "email_proof.invalid_recipient"],
    ["the same address twice", ["qa@x.pe", "QA@x.pe"], "email_proof.duplicate_recipient"],
  ])("refuses %s, and writes nothing", async (_label, recipients, reason) => {
    const proofs = new RecordingProofs();

    await expect(new SendEmailProofUseCase(proofs).run({ ...INPUT, recipients })).rejects.toMatchObject({ reason });
    expect(proofs.messages).toHaveLength(0);
  });
});

describe("renderEmail with a proof", () => {
  const email = {
    to: "qa@onlyonecoin.edu.pe",
    templateKey: "payment_approved",
    locale: "es-PE",
    vars: EMAIL_PREVIEW_SAMPLES.payment_approved,
  } as OutgoingEmail;

  it("marks the subject and changes nothing else", () => {
    const real = renderEmail(email);
    const proof = renderEmail({ ...email, proof: true });

    expect(proof.subject).toBe(`[PRUEBA] ${real.subject}`);
    expect(proof.text).toBe(real.text);
  });
});
