import type { AuthenticatedUser, Role } from "@ooc/domain";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { buildApp } from "@/app.js";
import { container } from "@/container.js";
import { SESSION_COOKIE_NAME } from "@/infra/auth/betterAuth.js";

/**
 * CI gate §6.5 for the issued documents (OOC-33). The batch is coordination's
 * (`analyst` reads, never issues; `billing` and the teacher do neither), the
 * staff download is the student file's three, and the portal routes are the
 * student account's. Refusals answer before the handler; allowed cases stub
 * the service, so no database or PDF renderer is needed.
 */

const GROUP = "018f2b5c-9100-7000-8000-0000000000a1";
const RUN = "018f2b5c-9100-7000-8000-0000000000a2";
const DOC = "018f2b5c-9100-7000-8000-0000000000a3";
const STUDENT = "018f2b5c-9100-7000-8000-0000000000a4";
const ENROLLMENT = "018f2b5c-9100-7000-8000-0000000000a5";

const BATCH = `/api/v1/catalog/class-groups/${GROUP}/modules/${RUN}/certificates`;
const ALL_ROLES: Role[] = [
  "master",
  "admin",
  "analyst",
  "enrollment_supervisor",
  "academic_supervisor",
  "teacher",
  "sales",
  "support",
  "billing",
  "student",
];

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
const others = (allowed: Role[]) => ALL_ROLES.filter((role) => !allowed.includes(role));

function stubService(): void {
  vi.spyOn(container.documents.issued, "previewCertificates").mockResolvedValue({
    closesTheCourse: true,
    examRequired: false,
    templatePublished: true,
    items: [],
  });
  vi.spyOn(container.documents.issued, "issueCertificates").mockResolvedValue({ issued: 1, skipped: 0 });
  vi.spyOn(container.documents.issued, "download").mockResolvedValue({ pdf: new Uint8Array([37, 80, 68, 70]), code: "OOC-2222-2222" });
  vi.spyOn(container.repositories.issuedDocuments, "studentExists").mockResolvedValue(true);
  vi.spyOn(container.repositories.issuedDocuments, "listForStudents").mockResolvedValue([]);
}

describe("GET the certificate batch preview", () => {
  const allowed: Role[] = ["master", "admin", "enrollment_supervisor", "academic_supervisor", "analyst"];

  it("refuses without a session", async () => {
    expect((await app.inject({ method: "GET", url: BATCH })).statusCode).toBe(401);
  });

  it.each(others(allowed))("refuses %s", async (role) => {
    signIn(role);
    expect((await app.inject({ method: "GET", url: BATCH, cookies })).statusCode).toBe(403);
  });

  it.each(allowed)("serves %s", async (role) => {
    signIn(role);
    stubService();
    expect((await app.inject({ method: "GET", url: BATCH, cookies })).statusCode).toBe(200);
  });
});

describe("POST the certificate batch", () => {
  const allowed: Role[] = ["master", "admin", "enrollment_supervisor", "academic_supervisor"];
  const payload = { enrollmentIds: [ENROLLMENT] };

  it.each(others(allowed))("refuses %s — the analyst reads, never issues", async (role) => {
    signIn(role);
    expect((await app.inject({ method: "POST", url: BATCH, cookies, payload })).statusCode).toBe(403);
  });

  it.each(allowed)("lets %s confirm it", async (role) => {
    signIn(role);
    stubService();
    const response = await app.inject({ method: "POST", url: BATCH, cookies, payload });
    expect(response.statusCode).toBe(200);
    expect(container.documents.issued.issueCertificates).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: "u1", enrollmentIds: [ENROLLMENT], examApprovedEnrollmentIds: [] }),
    );
  });

  it("refuses an empty batch", async () => {
    signIn("admin");
    expect((await app.inject({ method: "POST", url: BATCH, cookies, payload: { enrollmentIds: [] } })).statusCode).toBe(400);
  });
});

describe("staff: a student's issued documents", () => {
  const allowed: Role[] = ["master", "admin", "enrollment_supervisor"];
  const routes = [`/api/v1/students/${STUDENT}/issued-documents`, `/api/v1/issued-documents/${DOC}/pdf`];

  it.each(routes.flatMap((url) => others(allowed).map((role) => [url, role] as const)))("refuses %s to %s", async (url, role) => {
    signIn(role);
    expect((await app.inject({ method: "GET", url, cookies })).statusCode).toBe(403);
  });

  it("answers the PDF itself to the student file's roles", async () => {
    signIn("enrollment_supervisor");
    stubService();
    const response = await app.inject({ method: "GET", url: routes[1]!, cookies });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe("application/pdf");
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(container.documents.issued.download).toHaveBeenCalledWith({ actorId: "u1", documentId: DOC, portalAccount: false });
  });
});

describe("portal: the account's own issued documents", () => {
  const routes = ["/api/v1/portal/issued-documents", `/api/v1/portal/issued-documents/${DOC}/pdf`];

  it.each(routes.flatMap((url) => others(["student"]).map((role) => [url, role] as const)))(
    "refuses %s to %s",
    async (url, role) => {
      signIn(role);
      expect((await app.inject({ method: "GET", url, cookies })).statusCode).toBe(403);
    },
  );

  it("prints only through the account's reach", async () => {
    signIn("student");
    stubService();
    const response = await app.inject({ method: "GET", url: routes[1]!, cookies });
    expect(response.statusCode).toBe(200);
    expect(container.documents.issued.download).toHaveBeenCalledWith({ actorId: "u1", documentId: DOC, portalAccount: true });
  });
});

describe("staff: revoking an issued document (OOC-59)", () => {
  const allowed: Role[] = ["master", "admin", "enrollment_supervisor"];
  const url = `/api/v1/issued-documents/${DOC}/revoke`;
  const payload = { reason: "Nombre mal escrito" };

  it("refuses without a session", async () => {
    expect((await app.inject({ method: "POST", url, payload })).statusCode).toBe(401);
  });

  it.each(others(allowed))("refuses %s", async (role) => {
    signIn(role);
    expect((await app.inject({ method: "POST", url, cookies, payload })).statusCode).toBe(403);
  });

  it.each(allowed)("lets %s revoke, with the session as the actor", async (role) => {
    signIn(role);
    vi.spyOn(container.documents.issued, "revoke").mockResolvedValue({ revocationId: RUN });
    const response = await app.inject({ method: "POST", url, cookies, payload });
    expect(response.statusCode).toBe(201);
    expect(container.documents.issued.revoke).toHaveBeenCalledWith({ actorId: "u1", documentId: DOC, reason: payload.reason });
  });
});

describe("public: verifying a code (OOC-59)", () => {
  const found = {
    kind: "certificate" as const,
    status: "valid" as const,
    studentName: "María Quispe",
    courseName: "Inglés Básico",
    startsOn: "2026-09-01",
    endsOn: "2026-11-30",
    issuedAt: new Date("2026-11-19T15:00:00Z"),
    revokedAt: null,
  };

  it("answers without a session, public fields only", async () => {
    vi.spyOn(container.documents.issued, "verify").mockResolvedValue(found);
    const response = await app.inject({ method: "GET", url: "/api/v1/public/issued-documents/ooc-2222-2222" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(Object.keys(response.json() as object).sort()).toEqual(
      ["courseName", "endsOn", "issuedAt", "kind", "revokedAt", "startsOn", "status", "studentName"].sort(),
    );
    expect(container.documents.issued.verify).toHaveBeenCalledWith("ooc-2222-2222");
  });

  it("answers a code nobody issued with the generic 404", async () => {
    // The real service: a malformed code never reaches the database.
    const response = await app.inject({ method: "GET", url: "/api/v1/public/issued-documents/not-a-code" });
    expect(response.statusCode).toBe(404);
    expect((response.json() as { reason: string }).reason).toBe("issued_document.not_found");
  });
});
