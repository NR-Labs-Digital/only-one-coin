import {
  ValidateReceiptUseCase,
  type IReceiptValidationRepository,
  type PlatformSettings,
  type ReceiptValidationEffect,
  type ReceiptValidationSubject,
} from "@ooc/domain";
import { FakePlatformSettings, TEST_SETTINGS } from "./fakes/platformSettings.js";
import { describe, expect, it } from "vitest";

/**
 * The traffic light at the usecase level (OOC-21): the verdict is decided
 * here and handed to the repository with what it was decided from. It only
 * validates — approvals are never automatic (owner, 03/10/2026). What the
 * transaction guarantees — stamped once, only a non-green verdict on the
 * latest upload of a pending payment routes it to review — is SQL, covered
 * by DrizzleReceiptValidationRepository.integration.test.ts.
 */

const UPLOAD = "018f2b5c-0000-7000-8000-00000000u001";
const PAYMENT = "018f2b5c-0000-7000-8000-00000000p001";

type RecordParams = Parameters<IReceiptValidationRepository["record"]>[0];

class FakeValidationRepository implements IReceiptValidationRepository {
  recorded: RecordParams[] = [];
  constructor(
    public subject: ReceiptValidationSubject | null,
    private readonly effect: ReceiptValidationEffect = "routed_to_review",
  ) {}

  async findSubject() {
    return this.subject;
  }

  async record(params: RecordParams) {
    this.recorded.push(params);
    return this.effect;
  }
}

const SETTINGS: PlatformSettings = TEST_SETTINGS;

function subject(overrides: Partial<ReceiptValidationSubject> = {}): ReceiptValidationSubject {
  return {
    receiptUploadId: UPLOAD,
    paymentId: PAYMENT,
    paymentStatus: "pending",
    expectedCents: 15000,
    declaredOperationNumber: "08312457",
    readAmountCents: 15000,
    readOperationNumber: "08312457",
    declaredMethod: "yape",
    readMethod: "yape",
    ...overrides,
  };
}

function useCase(repository: FakeValidationRepository, settings: PlatformSettings = SETTINGS) {
  return new ValidateReceiptUseCase(repository, new FakePlatformSettings(settings));
}

describe("ValidateReceiptUseCase", () => {
  it("records a green verdict and hands nothing to settle — a person approves", async () => {
    const repository = new FakeValidationRepository(subject(), "none");

    const result = await useCase(repository).run({ receiptUploadId: UPLOAD });

    expect(result).toEqual({ outcome: { verdict: "approve", reason: "exact" }, effect: "none" });
    expect(Object.keys(repository.recorded[0]!).sort()).toEqual(["detail", "outcome", "subject"]);
  });

  it("records what the verdict was decided with", async () => {
    const repository = new FakeValidationRepository(subject({ readAmountCents: 15040 }));

    await useCase(repository, { ...SETTINGS, receiptAmountToleranceCents: 50, receiptRejectBelowPercent: 60 }).run({
      receiptUploadId: UPLOAD,
    });

    expect(repository.recorded[0]!.detail).toEqual({
      reason: "within_tolerance",
      expectedCents: 15000,
      readCents: 15040,
      toleranceCents: 50,
      rejectBelowPercent: 60,
    });
  });

  it("suggests rejection", async () => {
    const repository = new FakeValidationRepository(subject({ readAmountCents: 4000 }));

    const result = await useCase(repository).run({ receiptUploadId: UPLOAD });

    expect(result).toEqual({ outcome: { verdict: "reject_suggested", reason: "far_below" }, effect: "routed_to_review" });
  });

  it("sends a failed reading to review", async () => {
    const repository = new FakeValidationRepository(subject({ readAmountCents: null, readOperationNumber: null }));

    const result = await useCase(repository).run({ receiptUploadId: UPLOAD });

    expect(result.outcome).toEqual({ verdict: "review", reason: "amount_unread" });
    expect(repository.recorded[0]!.detail.readCents).toBeNull();
  });

  it("sends a green amount to review when the method read is not the declared one", async () => {
    const repository = new FakeValidationRepository(subject({ readMethod: "bcp" }));

    const result = await useCase(repository).run({ receiptUploadId: UPLOAD });

    expect(result.outcome).toEqual({ verdict: "review", reason: "payment_method_mismatch" });
  });

  it("does nothing when there is nothing to validate", async () => {
    const repository = new FakeValidationRepository(null);

    const result = await useCase(repository).run({ receiptUploadId: UPLOAD });

    expect(result).toEqual({ outcome: null, effect: null });
    expect(repository.recorded).toEqual([]);
  });
});
