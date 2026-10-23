import {
  PaymentAlreadySettledError,
  PaymentNotFoundError,
  PaymentSeatReleasedError,
  SettlePaymentUseCase,
  type EnrollmentEmailContext,
  type IEnrollmentEmailContextLookup,
  type IPaymentSettlementRepository,
  type IPortalLinkBuilder,
  type Locale,
  type PaymentToSettle,
  type PortalAccessOutcome,
  type PortalAccount,
} from "@ooc/domain";
import { beforeEach, describe, expect, it } from "vitest";

/**
 * Payments is where an enrollment is finished (OOC-55): approving confirms
 * the seat, rejecting hands it back. The usecase decides; the repository
 * makes it atomic. Pure domain here — fakes, no database.
 */

const ACTOR = "usr_billing";
const PAYMENT = "018f2b5c-0000-7000-8000-00000000p001";

class FakeSettlementRepository implements IPaymentSettlementRepository {
  public settled: Parameters<IPaymentSettlementRepository["settle"]>[0][] = [];
  public portalOutcome: PortalAccessOutcome = "created";
  constructor(public target: PaymentToSettle | null) {}

  async findForSettlement(): Promise<PaymentToSettle | null> {
    return this.target;
  }

  async settle(params: Parameters<IPaymentSettlementRepository["settle"]>[0]) {
    this.settled.push(params);
    const seatStatus =
      this.target!.seatStatus === "reserved" ? (params.to === "approved" ? "confirmed" : "released") : this.target!.seatStatus;
    return { seatStatus, portalAccess: params.portalAccess ? this.portalOutcome : null };
  }
}

class FakePortalLinkBuilder implements IPortalLinkBuilder {
  access(token: string, locale: Locale) {
    return `https://student.test/${locale}/access/${token}`;
  }
}

class FakeEmailContextLookup implements IEnrollmentEmailContextLookup {
  constructor(private readonly context: EnrollmentEmailContext | null) {}
  async find() {
    return this.context;
  }
}

const MINOR_CONTEXT: EnrollmentEmailContext = {
  student: { firstName: "Ana", lastName: "Quispe", email: "ana@gmail.com", birthDate: new Date("2014-05-01T00:00:00.000Z") },
  guardian: { firstName: "Rosa", email: "rosa@example.com" },
  courseName: "Inglés Básico",
  classGroupStartsOn: new Date("2026-11-02T00:00:00.000Z"),
};

function target(overrides: Partial<PaymentToSettle> = {}): PaymentToSettle {
  return {
    paymentId: PAYMENT,
    enrollmentId: "018f2b5c-0000-7000-8000-00000000e001",
    studentId: "018f2b5c-0000-7000-8000-00000000s001",
    classGroupId: "018f2b5c-0000-7000-8000-00000000g001",
    status: "pending",
    seatStatus: "reserved",
    ...overrides,
  };
}

let repository: FakeSettlementRepository;
let useCase: SettlePaymentUseCase;

beforeEach(() => {
  repository = new FakeSettlementRepository(target());
  useCase = new SettlePaymentUseCase(repository, new FakeEmailContextLookup(MINOR_CONTEXT), new FakePortalLinkBuilder());
});

describe("SettlePaymentUseCase", () => {
  it("approves an open payment and confirms the seat", async () => {
    const result = await useCase.run({ actorId: ACTOR, paymentId: PAYMENT, decision: { kind: "approve" } });

    expect(result).toEqual({ paymentId: PAYMENT, status: "approved", seatStatus: "confirmed", portalAccess: "created" });
    expect(repository.settled[0]!.to).toBe("approved");
    expect(repository.settled[0]!.audit).toMatchObject({ actorId: ACTOR, action: "payment.approved", targetId: PAYMENT });
    // The row and the trail tell the same story, to the instant.
    expect(repository.settled[0]!.decision).toEqual({ by: ACTOR, at: repository.settled[0]!.audit.at, rejectionReason: null });
  });

  it("asks for the student's portal account on approval, with a credentials e-mail behind a link", async () => {
    await useCase.run({ actorId: ACTOR, paymentId: PAYMENT, decision: { kind: "approve" } });

    const request = repository.settled[0]!.portalAccess!;
    expect(request.studentId).toBe(target().studentId);
    expect(request.actorId).toBe(ACTOR);
    expect(request.activation.purpose).toBe("activation");

    const account: PortalAccount = { userId: "usr_ana", email: "ana@gmail.com", name: "Ana Quispe", hasPassword: false };
    expect(request.notify(account, "tok_1")).toEqual([
      expect.objectContaining({
        templateKey: "portal_credentials",
        to: "ana@gmail.com",
        vars: expect.objectContaining({ accessUrl: `https://student.test/es-PE/access/${request.activation.token}` }),
      }),
    ]);
  });

  it("never asks for an account on a rejection", async () => {
    const result = await useCase.run({
      actorId: ACTOR,
      paymentId: PAYMENT,
      decision: { kind: "reject", reason: "illegible", note: "" },
    });
    expect(repository.settled[0]!.portalAccess).toBeNull();
    expect(result.portalAccess).toBeNull();
  });

  it("passes an e-mail conflict through without failing the approval", async () => {
    repository.portalOutcome = "email_conflict";
    const result = await useCase.run({ actorId: ACTOR, paymentId: PAYMENT, decision: { kind: "approve" } });
    expect(result).toMatchObject({ status: "approved", seatStatus: "confirmed", portalAccess: "email_conflict" });
  });

  it("tells the student and, for a minor, the guardian", async () => {
    await useCase.run({ actorId: ACTOR, paymentId: PAYMENT, decision: { kind: "approve" } });

    const emails = repository.settled[0]!.notifications;
    expect(emails.map((email) => [email.templateKey, email.to])).toEqual([
      ["payment_approved", "ana@gmail.com"],
      ["payment_approved", "rosa@example.com"],
    ]);
    expect(emails.every((email) => email.locale === "es-PE")).toBe(true);
  });

  it("rejects with a reason and the note in the audit trail", async () => {
    const result = await useCase.run({
      actorId: ACTOR,
      paymentId: PAYMENT,
      decision: { kind: "reject", reason: "amount_mismatch", note: "Pagó S/ 50" },
    });

    expect(result.status).toBe("rejected");
    expect(result.seatStatus).toBe("released");
    expect(repository.settled[0]!.audit.metadata).toMatchObject({ reason: "amount_mismatch", note: "Pagó S/ 50" });
    // The reason code goes on the payment too; the note stays in the trail only.
    expect(repository.settled[0]!.decision).toEqual({
      by: ACTOR,
      at: repository.settled[0]!.audit.at,
      rejectionReason: "amount_mismatch",
    });
    expect(repository.settled[0]!.notifications[0]!.templateKey).toBe("payment_rejected");
  });

  it("refuses a payment that does not exist", async () => {
    repository.target = null;

    await expect(useCase.run({ actorId: ACTOR, paymentId: PAYMENT, decision: { kind: "approve" } })).rejects.toBeInstanceOf(
      PaymentNotFoundError,
    );
  });

  it.each(["approved", "rejected"] as const)("refuses a payment already %s", async (status) => {
    repository.target = target({ status });

    await expect(useCase.run({ actorId: ACTOR, paymentId: PAYMENT, decision: { kind: "approve" } })).rejects.toBeInstanceOf(
      PaymentAlreadySettledError,
    );
    expect(repository.settled).toHaveLength(0);
  });

  it("refuses to approve money for a seat already handed back", async () => {
    repository.target = target({ seatStatus: "released" });

    await expect(useCase.run({ actorId: ACTOR, paymentId: PAYMENT, decision: { kind: "approve" } })).rejects.toBeInstanceOf(
      PaymentSeatReleasedError,
    );
  });

  it("still rejects when the seat is already gone — the money question stays open otherwise", async () => {
    repository.target = target({ seatStatus: "released" });

    const result = await useCase.run({
      actorId: ACTOR,
      paymentId: PAYMENT,
      decision: { kind: "reject", reason: "other", note: "" },
    });

    expect(result).toMatchObject({ status: "rejected", seatStatus: "released" });
  });
});
