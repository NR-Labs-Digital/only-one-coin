import {
  AnswerComplaintUseCase,
  ComplaintAlreadyAnsweredError,
  ComplaintAlreadyTakenError,
  ComplaintAnswerRequiredError,
  ComplaintNotFoundError,
  ListComplaintsUseCase,
  TakeComplaintUseCase,
  businessDaysUntil,
  complaintDueOn,
  endOfLimaDay,
  viewOfComplaint,
  type AuthenticatedUser,
  type ComplaintRecord,
  type EmailNotification,
  type IComplaintInboxRepository,
  type Role,
} from "@ooc/domain";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { buildApp } from "@/app.js";
import { container } from "@/container.js";
import { SESSION_COOKIE_NAME } from "@/infra/auth/betterAuth.js";
import { FakePlatformSettings } from "./fakes/platformSettings.js";

/**
 * The complaints book's inbox (OOC-58): the deadline clock, the use cases
 * over an in-memory book, and the CI gate §6.5 for its routes — reading is
 * `complaints.view` (management, analyst, support), taking and answering
 * `complaints.answer` (the analyst only reads).
 */

const ID = "0195f5d2-0000-7000-8000-000000000001";
const STUDENT_ID = "0195f5d2-0000-7000-8000-0000000000aa";

function sheet(overrides: Partial<ComplaintRecord> = {}): ComplaintRecord {
  return {
    id: ID,
    code: "2026-000001",
    kind: "claim",
    // Tuesday 24/11/2026, 10:30 in Lima.
    filedAt: new Date("2026-11-24T15:30:00.000Z"),
    supplier: { legalName: "ONLY ONE ACADEMY SAC", ruc: "20615261271", address: "Lima" },
    consumer: {
      firstName: "Rosa",
      lastName: "Quispe",
      secondLastName: "Mamani",
      nationalIdType: "DNI",
      nationalId: "41234567",
      phone: "987654321",
      email: "rosa@example.com",
      department: "Lima",
      province: "Lima",
      district: "Cercado",
      address: "Jr. Puno 10",
      addressReference: null,
      isMinor: false,
    },
    guardian: null,
    goodType: "service",
    amountCents: null,
    purchasedOn: null,
    description: "Atención",
    detail: "Nadie respondió.",
    request: "Que respondan.",
    locale: "pt-BR",
    taken: null,
    answered: null,
    student: null,
    ...overrides,
  };
}

describe("the answer deadline", () => {
  it("counts business days from the day after filing, in Lima", () => {
    // Tuesday + 15 business days = Tuesday three weeks later.
    expect(complaintDueOn(new Date("2026-11-24T15:30:00.000Z"), 15)).toBe("2026-12-15");
  });

  it("files late on Friday night in Lima as Friday, not Saturday", () => {
    // 23:30 Friday 27/11 in Lima is 04:30 Saturday in UTC.
    expect(complaintDueOn(new Date("2026-11-28T04:30:00.000Z"), 1)).toBe("2026-11-30");
  });

  it("starts on Monday when filed on a weekend", () => {
    expect(complaintDueOn(new Date("2026-11-28T15:00:00.000Z"), 1)).toBe("2026-11-30");
  });

  it("ends the last day at midnight in Lima", () => {
    expect(endOfLimaDay("2026-12-15").toISOString()).toBe("2026-12-16T05:00:00.000Z");
  });

  it("counts the business days left up to and including the last day", () => {
    // From Thursday 10/12 to Tuesday 15/12: Fri, Mon, Tue.
    expect(businessDaysUntil("2026-12-15", new Date("2026-12-10T15:00:00.000Z"))).toBe(3);
    expect(businessDaysUntil("2026-12-15", new Date("2026-12-15T15:00:00.000Z"))).toBe(0);
    expect(businessDaysUntil("2026-12-15", new Date("2026-12-20T15:00:00.000Z"))).toBe(0);
  });

  it("is overdue only unanswered and past the end of the last day", () => {
    const beforeEnd = viewOfComplaint(sheet(), 15, new Date("2026-12-16T04:59:00.000Z"));
    const afterEnd = viewOfComplaint(sheet(), 15, new Date("2026-12-16T05:00:00.000Z"));
    const answered = viewOfComplaint(
      sheet({ answered: { at: new Date("2026-12-17T00:00:00.000Z"), actorName: "Ana", answer: "Hola" } }),
      15,
      new Date("2026-12-20T00:00:00.000Z"),
    );
    expect(beforeEnd.overdue).toBe(false);
    expect(afterEnd.overdue).toBe(true);
    expect(answered).toMatchObject({ status: "answered", overdue: false, answeredLate: true });
  });
});

class InMemoryInbox implements IComplaintInboxRepository {
  taken: { complaintId: string; actorId: string }[] = [];
  answers: { complaintId: string; actorId: string; answer: string; emails: EmailNotification[] }[] = [];
  constructor(private readonly records: ComplaintRecord[]) {}
  list = () => Promise.resolve(this.records);
  findById = (id: string) => Promise.resolve(this.records.find((record) => record.id === id) ?? null);
  listForStudent = () => Promise.resolve([]);
  studentExists = () => Promise.resolve(true);
  take = (params: { complaintId: string; actorId: string }) => {
    this.taken.push(params);
    return Promise.resolve();
  };
  answer = (params: { complaintId: string; actorId: string; answer: string; emails: EmailNotification[] }) => {
    this.answers.push(params);
    return Promise.resolve();
  };
}

describe("the inbox", () => {
  it("counts every status under the search, and filters the items", async () => {
    const records = [
      sheet({ id: "a", code: "2026-000003" }),
      sheet({ id: "b", code: "2026-000002", taken: { at: new Date(), actorName: "Ana" } }),
      sheet({
        id: "c",
        code: "2026-000001",
        consumer: { ...sheet().consumer, firstName: "José", nationalId: "70000001" },
        answered: { at: new Date(), actorName: "Ana", answer: "Listo" },
      }),
    ];
    const list = new ListComplaintsUseCase(new InMemoryInbox(records), new FakePlatformSettings());

    const all = await list.run({ status: "received", overdue: false, search: null });
    expect(all.items.map((item) => item.id)).toEqual(["a"]);
    expect(all.counts).toMatchObject({ received: 1, in_progress: 1, answered: 1 });
    expect(all.responseBusinessDays).toBe(15);

    const searched = await list.run({ status: null, overdue: false, search: "jose" });
    expect(searched.items.map((item) => item.id)).toEqual(["c"]);
    expect(searched.counts).toMatchObject({ received: 0, in_progress: 0, answered: 1 });

    const byDocument = await list.run({ status: null, overdue: false, search: "70000001" });
    expect(byDocument.items.map((item) => item.id)).toEqual(["c"]);
  });

  it("takes a sheet once, never after the answer", async () => {
    const inbox = new InMemoryInbox([sheet()]);
    await new TakeComplaintUseCase(inbox).run({ complaintId: ID, actorId: "u1" });
    expect(inbox.taken).toEqual([{ complaintId: ID, actorId: "u1" }]);

    const taken = new InMemoryInbox([sheet({ taken: { at: new Date(), actorName: "Ana" } })]);
    await expect(new TakeComplaintUseCase(taken).run({ complaintId: ID, actorId: "u1" })).rejects.toBeInstanceOf(
      ComplaintAlreadyTakenError,
    );

    const answered = new InMemoryInbox([sheet({ answered: { at: new Date(), actorName: "Ana", answer: "x" } })]);
    await expect(new TakeComplaintUseCase(answered).run({ complaintId: ID, actorId: "u1" })).rejects.toBeInstanceOf(
      ComplaintAlreadyAnsweredError,
    );
    await expect(
      new TakeComplaintUseCase(new InMemoryInbox([])).run({ complaintId: ID, actorId: "u1" }),
    ).rejects.toBeInstanceOf(ComplaintNotFoundError);
  });

  it("answers once, trimmed, and e-mails the consumer in the form's language", async () => {
    const inbox = new InMemoryInbox([sheet()]);
    await new AnswerComplaintUseCase(inbox).run({ complaintId: ID, actorId: "u1", answer: "  Resolvido.\nObrigado.  " });

    expect(inbox.answers).toHaveLength(1);
    expect(inbox.answers[0]!.answer).toBe("Resolvido.\nObrigado.");
    expect(inbox.answers[0]!.emails).toEqual([
      expect.objectContaining({
        templateKey: "complaint_answered",
        to: "rosa@example.com",
        locale: "pt-BR",
        dedupeKey: `complaint_answered:${ID}`,
        vars: expect.objectContaining({ code: "2026-000001", answer: "Resolvido.\nObrigado.", kind: "claim" }),
      }),
    ]);
  });

  it("refuses an empty answer, a too long one and a second one", async () => {
    const inbox = new InMemoryInbox([sheet()]);
    await expect(
      new AnswerComplaintUseCase(inbox).run({ complaintId: ID, actorId: "u1", answer: "   " }),
    ).rejects.toBeInstanceOf(ComplaintAnswerRequiredError);
    await expect(
      new AnswerComplaintUseCase(inbox).run({ complaintId: ID, actorId: "u1", answer: "x".repeat(5001) }),
    ).rejects.toBeInstanceOf(ComplaintAnswerRequiredError);

    const answered = new InMemoryInbox([sheet({ answered: { at: new Date(), actorName: "Ana", answer: "x" } })]);
    await expect(
      new AnswerComplaintUseCase(answered).run({ complaintId: ID, actorId: "u1", answer: "Otra" }),
    ).rejects.toBeInstanceOf(ComplaintAlreadyAnsweredError);
    expect(inbox.answers).toHaveLength(0);
  });
});

describe("the inbox routes", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function signIn(role: Role): void {
    const user: AuthenticatedUser = { id: "u1", email: "x@example.com", name: "X", role, twoFactorEnabled: true };
    vi.spyOn(container.identity.currentSession, "resolve").mockResolvedValue(user);
  }

  const cookies = { [SESSION_COOKIE_NAME]: "token" };
  const view = viewOfComplaint(sheet({ student: { studentId: STUDENT_ID, fullName: "Rosa Quispe" } }), 15, new Date("2026-11-25T15:00:00.000Z"));

  const READS = [
    { method: "GET" as const, url: "/api/v1/complaints" },
    { method: "GET" as const, url: "/api/v1/complaints/summary" },
    { method: "GET" as const, url: `/api/v1/complaints/${ID}` },
    { method: "GET" as const, url: `/api/v1/students/${STUDENT_ID}/complaints` },
  ];
  const WRITES = [
    { method: "POST" as const, url: `/api/v1/complaints/${ID}/take`, payload: undefined },
    { method: "POST" as const, url: `/api/v1/complaints/${ID}/answer`, payload: { answer: "Hola" } },
  ];

  it.each([...READS, ...WRITES])("refuses $method $url without a session", async (route) => {
    const response = await app.inject({ method: route.method, url: route.url });
    expect(response.statusCode).toBe(401);
  });

  it.each<Role>(["billing", "sales", "enrollment_supervisor", "academic_supervisor", "teacher", "student"])(
    "refuses %s every route",
    async (role) => {
      signIn(role);
      for (const route of [...READS, ...WRITES]) {
        const response = await app.inject({
          method: route.method,
          url: route.url,
          cookies,
          ...("payload" in route && route.payload ? { payload: route.payload } : {}),
        });
        expect(response.statusCode, `${route.method} ${route.url}`).toBe(403);
      }
    },
  );

  it("refuses the analyst a take and an answer", async () => {
    signIn("analyst");
    for (const route of WRITES) {
      const response = await app.inject({ method: route.method, url: route.url, cookies, ...(route.payload ? { payload: route.payload } : {}) });
      expect(response.statusCode, route.url).toBe(403);
    }
  });

  it.each<Role>(["master", "admin", "analyst", "support"])("serves %s the inbox and the sheet", async (role) => {
    signIn(role);
    vi.spyOn(container.useCases.complaint.list, "run").mockResolvedValue({
      items: [view],
      counts: { received: 1, in_progress: 0, answered: 0, overdue: 0 },
      responseBusinessDays: 15,
    });
    vi.spyOn(container.useCases.complaint.get, "run").mockResolvedValue(view);

    const list = await app.inject({ method: "GET", url: "/api/v1/complaints?status=received&q=rosa", cookies });
    expect(list.statusCode).toBe(200);
    expect(list.json().items[0]).toMatchObject({
      code: "2026-000001",
      consumerName: "Rosa Quispe Mamani",
      status: "received",
      dueOn: "2026-12-15",
      student: { studentId: STUDENT_ID, fullName: "Rosa Quispe" },
    });

    const detail = await app.inject({ method: "GET", url: `/api/v1/complaints/${ID}`, cookies });
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toMatchObject({ answer: null, consumer: { email: "rosa@example.com" } });
  });

  it.each<Role>(["master", "admin", "support"])("lets %s take and answer", async (role) => {
    signIn(role);
    const take = vi.spyOn(container.useCases.complaint.take, "run").mockResolvedValue();
    const answer = vi.spyOn(container.useCases.complaint.answer, "run").mockResolvedValue();

    expect((await app.inject({ method: "POST", url: `/api/v1/complaints/${ID}/take`, cookies })).statusCode).toBe(204);
    expect(
      (await app.inject({ method: "POST", url: `/api/v1/complaints/${ID}/answer`, cookies, payload: { answer: "Hola" } }))
        .statusCode,
    ).toBe(204);
    expect(take).toHaveBeenCalledWith({ complaintId: ID, actorId: "u1" });
    expect(answer).toHaveBeenCalledWith({ complaintId: ID, actorId: "u1", answer: "Hola" });
  });

  it("answers a second answer with 409", async () => {
    signIn("admin");
    vi.spyOn(container.useCases.complaint.answer, "run").mockRejectedValue(new ComplaintAlreadyAnsweredError());
    const response = await app.inject({ method: "POST", url: `/api/v1/complaints/${ID}/answer`, cookies, payload: { answer: "Hola" } });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ reason: "complaint.already_answered" });
  });
});
