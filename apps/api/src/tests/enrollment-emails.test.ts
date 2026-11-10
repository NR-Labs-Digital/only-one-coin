import {
  CreateManualEnrollmentUseCase,
  Enrollment,
  Payment,
  SubmitPublicEnrollmentUseCase,
  type EmailNotification,
  type EnrollmentEmailContext,
  type IEnrollmentEmailContextLookup,
  type IEnrollmentRepository,
  type IPlanPriceLookup,
  type IPublicEnrollmentRepository,
  type IReceiptUploadRepository,
  type ISeatHoldRepository,
  type PublicEnrollmentContext,
  type ReceiptUpload,
  type SubmitPublicEnrollmentParams,
} from "@ooc/domain";
import { describe, expect, it } from "vitest";
import { FakeAuditLogRepository } from "./fakes/catalog.js";

/**
 * Which e-mails an enrollment queues, and for whom (decisions of 27/09/2026):
 * both enrollment paths send "enrollment received"; a minor's guardian gets
 * their own copy, an adult's optional guardian does not. The repositories are
 * fakes — what the database adds (the same transaction, the dedupe index) is
 * covered by DrizzleOutboxRepository.integration.test.ts.
 */

const STUDENT_ID = "018f2b5c-3000-7000-8000-000000000001";
const CLASS_GROUP_ID = "018f2b5c-3000-7000-8000-000000000002";
const HOLD_ID = "5b0e7a52-3c1d-4f7e-9a61-2f3c4d5e6f70";
const RECEIPT_UPLOAD_ID = "018f2b5c-3000-7000-8000-000000000005";
const PLAN_ID = "018f2b5c-3000-7000-8000-000000000003";
const PLAN_PRICE_ID = "018f2b5c-3000-7000-8000-000000000004";

const STARTS_ON = new Date("2026-10-05T05:00:00.000Z");

function yearsAgo(years: number): Date {
  const date = new Date();
  date.setUTCFullYear(date.getUTCFullYear() - years);
  return date;
}

class FakeEnrollmentRepository implements IEnrollmentRepository {
  notifications: EmailNotification[] = [];
  async createWithPayment(params: {
    enrollment: Enrollment;
    payment: Payment;
    notifications: EmailNotification[];
    receipt: { receiptUploadId: string; uploadedBy: string };
  }) {
    this.notifications = params.notifications;
    return { enrollment: params.enrollment, payment: params.payment };
  }
}

const priceLookup: IPlanPriceLookup = {
  findCurrentPrice: async () => ({ id: PLAN_PRICE_ID, amountCents: 25000 }),
};

function contextLookup(context: EnrollmentEmailContext | null): IEnrollmentEmailContextLookup {
  return { find: async () => context };
}

const MANUAL_INPUT = {
  actorId: "staff-1",
  studentId: STUDENT_ID,
  classGroupId: CLASS_GROUP_ID,
  planId: PLAN_ID,
  method: "yape" as const,
  methodDetail: null,
  operationNumber: "00012345",
  receiptUploadId: "018f2b5c-0000-7000-8000-0000000000aa",
};

describe("CreateManualEnrollmentUseCase e-mails", () => {
  it("queues one 'enrollment received' to an adult student, in es-PE", async () => {
    const repository = new FakeEnrollmentRepository();
    const useCase = new CreateManualEnrollmentUseCase(
      repository,
      priceLookup,
      contextLookup({
        student: { firstName: "Rosa", lastName: "Quispe", email: "rosa.quispe@gmail.com", birthDate: yearsAgo(30) },
        // An adult's optional guardian is not written to.
        guardian: { firstName: "Carmen", email: "carmen@hotmail.com" },
        courseName: "Inglés Básico",
        classGroupStartsOn: STARTS_ON,
      }),
      new FakeAuditLogRepository(),
    );

    const { enrollment } = await useCase.run(MANUAL_INPUT);

    expect(repository.notifications).toEqual([
      {
        templateKey: "enrollment_received",
        to: "rosa.quispe@gmail.com",
        locale: "es-PE",
        vars: {
          recipientName: "Rosa",
          studentName: "Rosa Quispe",
          courseName: "Inglés Básico",
          startsOn: STARTS_ON.toISOString(),
          amountCents: 25000,
        },
        dedupeKey: `enrollment_received:${enrollment.id}:student`,
      },
    ]);
  });

  it("copies a minor's guardian, greeting each by their own name", async () => {
    const repository = new FakeEnrollmentRepository();
    const useCase = new CreateManualEnrollmentUseCase(
      repository,
      priceLookup,
      contextLookup({
        student: { firstName: "Luis", lastName: "Quispe", email: "luis.quispe@gmail.com", birthDate: yearsAgo(12) },
        guardian: { firstName: "Carmen", email: "carmen@hotmail.com" },
        courseName: "Inglés Kids",
        classGroupStartsOn: STARTS_ON,
      }),
      new FakeAuditLogRepository(),
    );

    const { enrollment } = await useCase.run(MANUAL_INPUT);

    expect(repository.notifications.map((n) => [n.to, n.vars.recipientName, n.dedupeKey])).toEqual([
      ["luis.quispe@gmail.com", "Luis", `enrollment_received:${enrollment.id}:student`],
      ["carmen@hotmail.com", "Carmen", `enrollment_received:${enrollment.id}:guardian`],
    ]);
    expect(repository.notifications.every((n) => "studentName" in n.vars && n.vars.studentName === "Luis Quispe")).toBe(
      true,
    );
  });

  it("queues nothing when the student is not on file, and leaves the failure to the write", async () => {
    const repository = new FakeEnrollmentRepository();
    const useCase = new CreateManualEnrollmentUseCase(
      repository,
      priceLookup,
      contextLookup(null),
      new FakeAuditLogRepository(),
    );

    await useCase.run(MANUAL_INPUT);
    expect(repository.notifications).toEqual([]);
  });
});

class FakePublicEnrollmentRepository implements IPublicEnrollmentRepository {
  params: SubmitPublicEnrollmentParams | null = null;

  async findContext(): Promise<PublicEnrollmentContext> {
    return {
      courseMinAge: 7,
      planPriceId: PLAN_PRICE_ID,
      amountCents: 25000,
      courseName: "Inglés Kids",
      classGroupStartsOn: STARTS_ON,
    };
  }

  async submit(params: SubmitPublicEnrollmentParams) {
    this.params = params;
    return { student: params.student, guardian: params.guardian, enrollment: params.enrollment, payment: params.payment };
  }
}

/** A hold that is alive for `classGroupId` — the submit only reads its origin. */
function heldSeat(classGroupId: string): ISeatHoldRepository {
  const hold = { id: HOLD_ID, classGroupId, origin: "web" as const, expiresAt: new Date(Date.now() + 60_000) };
  return {
    claim: async () => ({ kind: "held", hold }),
    find: async (id) => (id === HOLD_ID ? hold : null),
    release: async () => true,
    expireDue: async () => 0,
  };
}

/** Uploaded and confirmed for `HOLD_ID` — these tests only exercise which
 * e-mails queue, never the receipt itself. */
function confirmedReceipt(): IReceiptUploadRepository {
  const receipt: ReceiptUpload = {
    id: RECEIPT_UPLOAD_ID,
    seatHoldId: HOLD_ID,
    procedureRequestId: null,
    uploadedBy: null,
    paymentId: null,
    objectKey: `receipts/raw/${HOLD_ID}/${RECEIPT_UPLOAD_ID}`,
    status: "uploaded",
    processedObjectKey: null,
  };
  return {
    create: async () => {
      throw new Error("not exercised by these tests");
    },
    findById: async (id) => (id === RECEIPT_UPLOAD_ID ? receipt : null),
    markUploaded: async () => {
      throw new Error("not exercised by these tests");
    },
  };
}

describe("SubmitPublicEnrollmentUseCase e-mails", () => {
  it("writes to the student and the minor's guardian in the locale the form was filled in", async () => {
    const repository = new FakePublicEnrollmentRepository();
    const useCase = new SubmitPublicEnrollmentUseCase(repository, heldSeat(CLASS_GROUP_ID), confirmedReceipt());

    await useCase.run({
      seatHoldId: HOLD_ID,
      receiptUploadId: RECEIPT_UPLOAD_ID,
      classGroupId: CLASS_GROUP_ID,
      planId: PLAN_ID,
      student: {
        firstName: "Luis",
        lastName: "Quispe",
        nationalIdType: "DNI",
        nationalId: "71234567",
        email: "luis.quispe@gmail.com",
        phone: "+51987654321",
        birthDate: yearsAgo(12),
        country: "PE",
        region: "Lima",
        city: "Chorrillos",
      },
      guardian: {
        firstName: "Carmen",
        lastName: "Rojas",
        relationship: "mother",
        nationalIdType: "DNI",
        nationalId: "40123456",
        email: "carmen@hotmail.com",
        phone: "+51912345678",
      },
      consent: { version: "v1", ip: "203.0.113.7" },
      locale: "pt-BR",
      payment: {
        method: "yape",
        methodDetail: null,
        operationNumber: "00012345",
        idempotencyKey: "018f2b5c-3000-7000-8000-0000000000aa",
      },
    });

    const notifications = repository.params!.notifications;
    expect(notifications.map((n) => [n.templateKey, n.to, n.locale])).toEqual([
      ["enrollment_received", "luis.quispe@gmail.com", "pt-BR"],
      ["enrollment_received", "carmen@hotmail.com", "pt-BR"],
    ]);
    expect(notifications[0]!.dedupeKey).toBe(`enrollment_received:${repository.params!.enrollment.id}:student`);
  });

  it("audits the manual enrollment under its id, naming who opened it (OOC-75)", async () => {
    const audit = new FakeAuditLogRepository();
    const useCase = new CreateManualEnrollmentUseCase(new FakeEnrollmentRepository(), priceLookup, contextLookup(null), audit);

    const { enrollment, payment } = await useCase.run(MANUAL_INPUT);

    expect(audit.appended).toEqual([
      expect.objectContaining({
        actorId: "staff-1",
        action: "enrollment.created",
        targetId: enrollment.id,
        metadata: { studentId: MANUAL_INPUT.studentId, paymentId: payment.id, receiptUploadId: MANUAL_INPUT.receiptUploadId },
      }),
    ]);
  });
});
