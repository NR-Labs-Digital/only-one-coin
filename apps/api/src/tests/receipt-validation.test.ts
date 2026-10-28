import {
  ValidateReceiptUseCase,
  type EnrollmentEmailContext,
  type IEnrollmentEmailContextLookup,
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

class FakeEmailContextLookup implements IEnrollmentEmailContextLookup {
  constructor(private readonly context: EnrollmentEmailContext | null) {}
  async find() {
    return this.context;
  }
}

const ADULT_CONTEXT: EnrollmentEmailContext = {
  student: { firstName: "Luis", lastName: "Huamán", email: "luis@gmail.com", birthDate: new Date("1998-03-10T00:00:00.000Z") },
  guardian: null,
  courseName: "Inglés Básico",
  classGroupStartsOn: new Date("2026-11-02T00:00:00.000Z"),
};

const SETTINGS: PlatformSettings = TEST_SETTINGS;

function subject(overrides: Partial<ReceiptValidationSubject> = {}): ReceiptValidationSubject {
  return {
    receiptUploadId: UPLOAD,
    paymentId: PAYMENT,
    studentId: "018f2b5c-0000-7000-8000-00000000s001",
    classGroupId: "018f2b5c-0000-7000-8000-00000000g001",
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

function useCase(
  repository: FakeValidationRepository,
  settings: PlatformSettings = SETTINGS,
  context: EnrollmentEmailContext | null = ADULT_CONTEXT,
) {
  return new ValidateReceiptUseCase(repository, new FakePlatformSettings(settings), new FakeEmailContextLookup(context));
}

describe("ValidateReceiptUseCase", () => {
  it("records a green verdict and hands nothing to settle — a person approves", async () => {
    const repository = new FakeValidationRepository(subject(), "none");

    const result = await useCase(repository).run({ receiptUploadId: UPLOAD });

    expect(result).toEqual({ outcome: { verdict: "approve", reason: "exact" }, effect: "none" });
    expect(Object.keys(repository.recorded[0]!).sort()).toEqual(["detail", "notifications", "outcome", "subject"]);
    expect(repository.recorded[0]!.notifications).toEqual([]);
  });

  it("hands over the under-review e-mail with a verdict that is not green (OOC-87)", async () => {
    const repository = new FakeValidationRepository(subject({ readAmountCents: 4000 }));

    await useCase(repository).run({ receiptUploadId: UPLOAD });

    // An adult's optional guardian is not written to — only a minor's is.
    expect(repository.recorded[0]!.notifications).toEqual([
      {
        templateKey: "payment_under_review",
        to: "luis@gmail.com",
        locale: "es-PE",
        vars: { recipientName: "Luis", studentName: "Luis Huamán", courseName: "Inglés Básico" },
        dedupeKey: `payment_under_review:${PAYMENT}:student`,
      },
    ]);
  });

  it("still validates when there is nobody on file to write to", async () => {
    const repository = new FakeValidationRepository(subject({ readAmountCents: 4000 }));

    const result = await useCase(repository, SETTINGS, null).run({ receiptUploadId: UPLOAD });

    expect(result.effect).toBe("routed_to_review");
    expect(repository.recorded[0]!.notifications).toEqual([]);
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
