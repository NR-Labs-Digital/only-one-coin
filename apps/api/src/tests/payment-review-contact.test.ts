import type { AuthenticatedUser, Role } from "@ooc/domain";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { buildApp } from "@/app.js";
import { container } from "@/container.js";
import { SESSION_COOKIE_NAME } from "@/infra/auth/betterAuth.js";

/**
 * The review queue's WhatsApp shortcut (OOC-146): the student's mobile number
 * reaches only the roles that act on the payment or answer the student
 * (`PAYMENT_CONTACT_ROLES`). Every other reader of the queue gets `null`.
 */

const ROW = {
  id: "018f2b5c-0000-7000-8000-000000000001",
  enrollmentId: "018f2b5c-0000-7000-8000-000000000002",
  procedureKind: null,
  studentId: "018f2b5c-0000-7000-8000-000000000003",
  studentName: "Rosa Quispe",
  studentPhone: "+51987654321",
  courseName: "Inglés",
  classGroupName: "A-00001",
  planName: "Paquete",
  status: "pending" as const,
  method: "yape" as const,
  methodDetail: null,
  operationNumber: "00012345",
  expectedAmountCents: 25000,
  currency: "PEN" as const,
  receipt: "ready" as const,
  fraudSignals: [],
  reading: null,
  readingSource: "first" as const,
  rereadRequestedAt: null,
  confidence: null,
  verdict: null,
  submittedAt: new Date("2026-11-01T12:00:00.000Z"),
  reviewDeadline: new Date("2026-11-06T12:00:00.000Z"),
};

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

async function phoneSeenBy(role: Role): Promise<string | null> {
  const user: AuthenticatedUser = { id: "u1", email: "x@example.com", name: "X", role, twoFactorEnabled: true };
  vi.spyOn(container.identity.currentSession, "resolve").mockResolvedValue(user);
  vi.spyOn(container.queries.listPaymentReviewQueue, "run").mockResolvedValue({
    items: [ROW],
    total: 1,
    page: 1,
    pageSize: 25,
  } as Awaited<ReturnType<typeof container.queries.listPaymentReviewQueue.run>>);

  const response = await app.inject({
    method: "GET",
    url: "/api/v1/payments/review",
    cookies: { [SESSION_COOKIE_NAME]: "token" },
  });
  expect(response.statusCode).toBe(200);
  return (response.json() as { items: { studentPhone: string | null }[] }).items[0]!.studentPhone;
}

describe("review queue contact", () => {
  it.each<Role>(["master", "admin", "billing", "support"])("sends the mobile number to %s", async (role) => {
    expect(await phoneSeenBy(role)).toBe("+51987654321");
  });

  it("keeps it off the analyst's screen", async () => {
    expect(await phoneSeenBy("analyst")).toBeNull();
  });
});
