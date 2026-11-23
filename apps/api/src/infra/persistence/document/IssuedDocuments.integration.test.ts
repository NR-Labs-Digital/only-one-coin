import * as schema from "@ooc/db";
import {
  academicPeriods,
  auditLog,
  classGroupModules,
  classGroups,
  courses,
  documentTemplateVersions,
  enrollments,
  grades,
  guardians,
  issuedDocuments,
  outbox,
  planPrices,
  plans,
  procedurePrices,
  procedureRequests,
  students,
} from "@ooc/db";
import { CertificateNothingToIssueError, CertificateRunNotLastModuleError } from "@ooc/domain";
import { TemplateEngine } from "@ooc/templates";
import { and, eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/infra/db/client.js";
import { DocumentPreviewService } from "@/documents/DocumentPreviewService.js";
import { DOCUMENT_KINDS, DocumentTemplateCompiler } from "@/documents/documentKinds.js";
import { IssuedDocumentService } from "@/documents/IssuedDocumentService.js";
import { DrizzleAuditLogRepository } from "@/infra/identity/DrizzleAuditLogRepository.js";
import { DrizzleDocumentTemplateRepository } from "@/infra/persistence/document/DrizzleDocumentTemplateRepository.js";
import { DrizzlePlatformSettingsRepository } from "@/infra/persistence/platform/DrizzlePlatformSettingsRepository.js";
import { DrizzleTeacherRepository } from "@/infra/persistence/teacher/DrizzleTeacherRepository.js";
import { DrizzleIssuedDocumentRepository } from "./DrizzleIssuedDocumentRepository.js";

/**
 * The issued documents (OOC-33) against Postgres: the certificate rule over
 * real grades (last module, earlier modules on the platform, DA), the batch
 * recorded with its e-mails and audit entries, the constancia of a paid
 * request, and the portal's reach. The PDF renderer is a stub — WeasyPrint is
 * not in CI — but the template engine is the real one, so a template that
 * cannot print a record still refuses it.
 *
 * Every test runs in a transaction that is always rolled back.
 */

const { Pool } = pg;
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is required: this suite exercises the issued documents against a real, migrated Postgres.");
}

const ID = (n: number) => `018f2b5c-9300-7000-8000-${String(n).padStart(12, "0")}`;
const STAFF = "ooc33-staff";
const ACCOUNT = "ooc33-student-account";
const STRANGER = "ooc33-stranger-account";
const PERIOD = ID(1);
const COURSE = ID(2);
const PLAN = ID(3);
const PLAN_PRICE = ID(4);
const GROUP = ID(5);
const MODULE_1 = ID(6);
const MODULE_2 = ID(7);
const PASSED = ID(11);
const BELOW = ID(12);
const EARLIER_DA = ID(13);
const NO_GRADE = ID(14);
const RESERVED = ID(15);

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
class RolledBack extends Error {}

let pool: pg.Pool;
let db: Db;

beforeAll(() => {
  pool = new Pool({ connectionString: DATABASE_URL, max: 2 });
  db = drizzle(pool, { schema, casing: "snake_case" });
});

afterAll(async () => {
  await pool.end();
});

const printed: string[] = [];
const renderer = {
  render(html: string) {
    printed.push(html);
    return Promise.resolve(new Uint8Array([37, 80, 68, 70]));
  },
};

function serviceOn(tx: Db) {
  const templates = new DrizzleDocumentTemplateRepository(tx);
  const preview = new DocumentPreviewService(
    new TemplateEngine(),
    renderer,
    new DocumentTemplateCompiler(new TemplateEngine()),
    templates,
    new DrizzleTeacherRepository(tx),
  );
  const repository = new DrizzleIssuedDocumentRepository(tx);
  return {
    repository,
    service: new IssuedDocumentService(
      preview,
      templates,
      repository,
      new DrizzlePlatformSettingsRepository(tx),
      new DrizzleAuditLogRepository(tx),
      "https://portal.test",
    ),
  };
}

/** Runs `body` over a seeded class group in a rolled-back transaction. */
async function seeded(body: (tx: Db) => Promise<void>): Promise<void> {
  try {
    await db.transaction(async (raw: Tx) => {
      const tx = raw as unknown as Db;
      await seed(tx);
      await body(tx);
      throw new RolledBack();
    });
  } catch (error) {
    if (!(error instanceof RolledBack)) throw error;
  }
}

async function seed(tx: Db): Promise<void> {
  await tx.execute(
    sql`insert into "user" ("id", "name", "email", "emailVerified", "role", "createdAt", "updatedAt")
        values (${STAFF}, 'Coordinación', 'ooc33.staff@test.local', true, 'admin', now(), now()),
               (${ACCOUNT}, 'Alumna', 'ooc33.student@test.local', true, 'student', now(), now()),
               (${STRANGER}, 'Otra', 'ooc33.stranger@test.local', true, 'student', now(), now())`,
  );
  await tx.insert(academicPeriods).values({
    id: PERIOD,
    name: "Ciclo OOC-33",
    startsOn: new Date("2026-08-01T05:00:00.000Z"),
    endsOn: new Date("2026-12-31T05:00:00.000Z"),
  });
  await tx.insert(courses).values({
    id: COURSE,
    name: "Inglés OOC-33",
    language: "Lengua OOC-33",
    minAge: 12,
    level: "A1",
    modules: 2,
    totalHours: 40,
  });
  await tx.insert(plans).values({ id: PLAN, courseId: COURSE, name: "Paquete" });
  await tx.insert(planPrices).values({ id: PLAN_PRICE, planId: PLAN, amountCents: 20000 });
  await tx.insert(classGroups).values({
    id: GROUP,
    courseId: COURSE,
    academicPeriodId: PERIOD,
    schedule: "",
    code: "A-93300",
    startsOn: new Date("2026-08-03T05:00:00.000Z"),
    endsOn: new Date("2026-11-13T05:00:00.000Z"),
    capacity: 30,
    seatsTaken: 5,
    status: "in_progress",
  });
  const slots = [{ weekday: "mon", startTime: "19:00", endTime: "20:30" }];
  await tx.insert(classGroupModules).values([
    { id: MODULE_1, classGroupId: GROUP, module: 1, slots },
    { id: MODULE_2, classGroupId: GROUP, module: 2, slots },
  ]);

  const people = [
    { enrollment: PASSED, n: 21, seat: "confirmed" as const, birth: "2012-04-01" },
    { enrollment: BELOW, n: 22, seat: "confirmed" as const, birth: "2000-01-01" },
    { enrollment: EARLIER_DA, n: 23, seat: "confirmed" as const, birth: "2000-01-01" },
    { enrollment: NO_GRADE, n: 24, seat: "confirmed" as const, birth: "2000-01-01" },
    { enrollment: RESERVED, n: 25, seat: "reserved" as const, birth: "2000-01-01" },
  ];
  for (const person of people) {
    await tx.insert(students).values({
      id: ID(person.n),
      firstName: `Nombre${person.n}`,
      lastName: `Apellido${person.n}`,
      nationalIdType: "DNI",
      nationalId: `9330${person.n}00`,
      email: `ooc33.${person.n}@gmail.com`,
      phone: "+51900000000",
      birthDate: new Date(`${person.birth}T00:00:00.000Z`),
      country: "PE",
      city: "Lima",
      userId: person.enrollment === PASSED ? ACCOUNT : null,
    });
    await tx.insert(enrollments).values({
      id: person.enrollment,
      studentId: ID(person.n),
      classGroupId: GROUP,
      classGroupModuleId: MODULE_2,
      planPriceId: PLAN_PRICE,
      seatStatus: person.seat,
    });
  }
  // The minor has a guardian: the certificate's e-mail reaches them too.
  await tx.insert(guardians).values({
    studentId: ID(21),
    firstName: "Rosa",
    lastName: "Apellido21",
    relationship: "mother",
    nationalIdType: "DNI",
    nationalId: "93302199",
    email: "ooc33.guardian@example.com",
    phone: "+51900000001",
  });

  const grade = (enrollmentId: string, moduleId: string, value: number | "da") => ({
    enrollmentId,
    classGroupId: GROUP,
    classGroupModuleId: moduleId,
    attempt: 1,
    score: value === "da" ? null : value,
    didNotSit: value === "da",
    recordedBy: STAFF,
  });
  await tx.insert(grades).values([
    grade(PASSED, MODULE_1, 15),
    grade(PASSED, MODULE_2, 16.5),
    grade(BELOW, MODULE_2, 12),
    grade(EARLIER_DA, MODULE_1, "da"),
    grade(EARLIER_DA, MODULE_2, 18),
  ]);

  await tx.insert(documentTemplateVersions).values([
    { kind: "certificate", version: 1, body: DOCUMENT_KINDS.certificate.starterBody, publishedBy: STAFF },
    {
      kind: "enrollment_certificate",
      version: 1,
      body: DOCUMENT_KINDS.enrollment_certificate.starterBody,
      publishedBy: STAFF,
    },
  ]);
}

const reasonOf = (items: { enrollmentId: string; blockReason: string | null }[], id: string) =>
  items.find((item) => item.enrollmentId === id)?.blockReason;

describe("the certificate batch (OOC-33)", () => {
  it("previews the last module's confirmed seats with the rule's verdict", async () => {
    await seeded(async (tx) => {
      const preview = await serviceOn(tx).service.previewCertificates({ classGroupId: GROUP, moduleId: MODULE_2 });

      expect(preview.closesTheCourse).toBe(true);
      expect(preview.templatePublished).toBe(true);
      // The reserved seat is not in the batch.
      expect(preview.items.map((item) => item.enrollmentId).sort()).toEqual([BELOW, EARLIER_DA, NO_GRADE, PASSED].sort());
      expect(reasonOf(preview.items, PASSED)).toBeNull();
      expect(reasonOf(preview.items, BELOW)).toBe("grade_below_minimum");
      expect(reasonOf(preview.items, EARLIER_DA)).toBe("earlier_module_failed");
      expect(reasonOf(preview.items, NO_GRADE)).toBe("grade_pending");
    });
  });

  it("offers no batch on a module group that is not the course's last", async () => {
    await seeded(async (tx) => {
      const { service } = serviceOn(tx);
      const preview = await service.previewCertificates({ classGroupId: GROUP, moduleId: MODULE_1 });
      expect(preview).toMatchObject({ closesTheCourse: false, items: [] });
      await expect(
        service.issueCertificates({
          actorId: STAFF,
          classGroupId: GROUP,
          moduleId: MODULE_1,
          enrollmentIds: [PASSED],
          examApprovedEnrollmentIds: [],
        }),
      ).rejects.toBeInstanceOf(CertificateRunNotLastModuleError);
    });
  });

  it("issues what still qualifies, with its e-mails and audit entries, once", async () => {
    await seeded(async (tx) => {
      const { service } = serviceOn(tx);
      const result = await service.issueCertificates({
        actorId: STAFF,
        classGroupId: GROUP,
        moduleId: MODULE_2,
        enrollmentIds: [PASSED, BELOW],
        examApprovedEnrollmentIds: [],
      });
      expect(result).toEqual({ issued: 1, skipped: 1 });

      const [document] = await tx.select().from(issuedDocuments).where(eq(issuedDocuments.enrollmentId, PASSED));
      expect(document).toMatchObject({ kind: "certificate", classGroupModuleId: MODULE_2, issuedBy: STAFF });
      expect(document!.code).toMatch(/^OOC-[2-9A-Z]{4}-[2-9A-Z]{4}$/);
      expect(document!.data).toMatchObject({ finalGrade: "16.5", student: { fullName: "Nombre21 Apellido21" } });

      // The minor's guardian hears too; one row per address.
      const mails = await tx
        .select({ to: outbox.recipient, template: outbox.templateKey })
        .from(outbox)
        .where(sql`${outbox.dedupeKey} like ${`certificate_issued:${document!.id}:%`}`);
      expect(mails.map((mail) => mail.to).sort()).toEqual(["ooc33.21@gmail.com", "ooc33.guardian@example.com"]);

      const actions = await tx
        .select({ action: auditLog.action })
        .from(auditLog)
        .where(inArray(auditLog.targetId, [document!.id, MODULE_2]));
      expect(actions.map((row) => row.action).sort()).toEqual(["certificate.batch_issued", "issued_document.issued"]);

      // Confirming again issues nothing: the seat now reads as already issued.
      await expect(
        service.issueCertificates({
          actorId: STAFF,
          classGroupId: GROUP,
          moduleId: MODULE_2,
          enrollmentIds: [PASSED],
          examApprovedEnrollmentIds: [],
        }),
      ).rejects.toBeInstanceOf(CertificateNothingToIssueError);
      const preview = await service.previewCertificates({ classGroupId: GROUP, moduleId: MODULE_2 });
      expect(reasonOf(preview.items, PASSED)).toBe("already_issued");
    });
  });

  it("needs coordination's exam mark on a course that asks for the certification exam", async () => {
    await seeded(async (tx) => {
      await tx.update(courses).set({ certificateRule: "exam_required" }).where(eq(courses.id, COURSE));
      const { service } = serviceOn(tx);
      const preview = await service.previewCertificates({ classGroupId: GROUP, moduleId: MODULE_2 });
      expect(reasonOf(preview.items, PASSED)).toBe("exam_not_approved");

      const base = { actorId: STAFF, classGroupId: GROUP, moduleId: MODULE_2, enrollmentIds: [PASSED] };
      await expect(service.issueCertificates({ ...base, examApprovedEnrollmentIds: [] })).rejects.toBeInstanceOf(
        CertificateNothingToIssueError,
      );
      expect(await service.issueCertificates({ ...base, examApprovedEnrollmentIds: [PASSED] })).toEqual({
        issued: 1,
        skipped: 0,
      });
      const [batch] = await tx
        .select({ metadata: auditLog.metadata })
        .from(auditLog)
        .where(and(eq(auditLog.action, "certificate.batch_issued"), eq(auditLog.targetId, MODULE_2)));
      expect(batch!.metadata).toMatchObject({ classGroupId: GROUP, examApprovedEnrollmentIds: [PASSED] });
    });
  });
});

describe("the constancia of a paid request (OOC-33)", () => {
  it("is issued once, moves the request to fulfilled and tells the student", async () => {
    await seeded(async (tx) => {
      const [price] = await tx
        .insert(procedurePrices)
        .values({ kind: "enrollment_certificate", amountCents: 2500, createdBy: STAFF })
        .returning({ id: procedurePrices.id });
      const [request] = await tx
        .insert(procedureRequests)
        .values({
          kind: "enrollment_certificate",
          studentId: ID(22),
          enrollmentId: BELOW,
          procedurePriceId: price!.id,
          amountCents: 2500,
          status: "paid",
        })
        .returning({ id: procedureRequests.id });

      const { service } = serviceOn(tx);
      const first = await service.issuePendingConstancias(500);
      expect(first.issued).toBeGreaterThanOrEqual(1);

      const [document] = await tx
        .select()
        .from(issuedDocuments)
        .where(eq(issuedDocuments.procedureRequestId, request!.id));
      expect(document).toMatchObject({ kind: "enrollment_certificate", enrollmentId: BELOW, issuedBy: null });
      expect(document!.data).toMatchObject({ classGroup: { code: "A-93300", module: 2, startsOn: "2026-08-03" } });
      const [moved] = await tx
        .select({ status: procedureRequests.status })
        .from(procedureRequests)
        .where(eq(procedureRequests.id, request!.id));
      expect(moved!.status).toBe("fulfilled");
      const mails = await tx
        .select({ to: outbox.recipient })
        .from(outbox)
        .where(sql`${outbox.dedupeKey} like ${`enrollment_certificate_issued:${document!.id}:%`}`);
      expect(mails.map((mail) => mail.to)).toEqual(["ooc33.22@gmail.com"]);

      // The next tick finds nothing for this request.
      await service.issuePendingConstancias(500);
      const again = await tx
        .select({ id: issuedDocuments.id })
        .from(issuedDocuments)
        .where(eq(issuedDocuments.procedureRequestId, request!.id));
      expect(again).toHaveLength(1);
    });
  });

  it("waits while the constancia has no published template", async () => {
    await seeded(async (tx) => {
      const { repository } = serviceOn(tx);
      const templates = {
        findPublished: () => Promise.resolve(null),
        findVersion: () => Promise.resolve(null),
      } as unknown as DrizzleDocumentTemplateRepository;
      const service = new IssuedDocumentService(
        {} as DocumentPreviewService,
        templates,
        repository,
        new DrizzlePlatformSettingsRepository(tx),
        new DrizzleAuditLogRepository(tx),
        "https://portal.test",
      );
      expect(await service.issuePendingConstancias()).toEqual({ issued: 0, unprintable: 0 });
    });
  });
});

describe("printing an issued document (OOC-33)", () => {
  async function issueOne(tx: Db): Promise<string> {
    await serviceOn(tx).service.issueCertificates({
      actorId: STAFF,
      classGroupId: GROUP,
      moduleId: MODULE_2,
      enrollmentIds: [PASSED],
      examApprovedEnrollmentIds: [],
    });
    const [document] = await tx.select({ id: issuedDocuments.id }).from(issuedDocuments).where(eq(issuedDocuments.enrollmentId, PASSED));
    return document!.id;
  }

  it("prints from the recorded version with the code in the frame, and audits it", async () => {
    await seeded(async (tx) => {
      const id = await issueOne(tx);
      printed.length = 0;
      const { code } = await serviceOn(tx).service.download({ actorId: STAFF, documentId: id, portalAccount: false });
      expect(printed[0]).toContain(code);
      expect(printed[0]).toContain("Nombre21 Apellido21");
      const [entry] = await tx
        .select({ metadata: auditLog.metadata })
        .from(auditLog)
        .where(and(eq(auditLog.action, "issued_document.downloaded"), eq(auditLog.targetId, id)));
      expect(entry!.metadata).toMatchObject({ studentId: ID(21), kind: "certificate" });
    });
  });

  it("reaches a portal account only through its own files", async () => {
    await seeded(async (tx) => {
      const id = await issueOne(tx);
      const { repository } = serviceOn(tx);
      expect(await repository.findForAccount(ACCOUNT, id)).toMatchObject({ id });
      expect(await repository.findForAccount(STRANGER, id)).toBeNull();
      expect((await repository.listForStudents([ID(21)])).map((item) => item.id)).toEqual([id]);
    });
  });
});

describe("revoking and verifying (OOC-59)", () => {
  async function issueFor(tx: Db): Promise<{ id: string; code: string }> {
    await serviceOn(tx).service.issueCertificates({
      actorId: STAFF,
      classGroupId: GROUP,
      moduleId: MODULE_2,
      enrollmentIds: [PASSED],
      examApprovedEnrollmentIds: [],
    });
    const rows = await tx
      .select({ id: issuedDocuments.id, code: issuedDocuments.code, replacesId: issuedDocuments.replacesId })
      .from(issuedDocuments)
      .where(eq(issuedDocuments.enrollmentId, PASSED));
    const latest = rows.find((row) => !rows.some((other) => other.replacesId === row.id))!;
    return { id: latest.id, code: latest.code };
  }

  it("answers a code with the public fields of the frozen data, and nothing else", async () => {
    await seeded(async (tx) => {
      const { code } = await issueFor(tx);
      const found = await serviceOn(tx).service.verify(code.toLowerCase().replace(/-/g, " "));
      expect(found).toEqual({
        kind: "certificate",
        status: "valid",
        studentName: "Nombre21 Apellido21",
        courseName: expect.any(String),
        startsOn: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        endsOn: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        issuedAt: expect.any(Date),
        revokedAt: null,
      });
      await expect(serviceOn(tx).service.verify("OOC-2222-2222")).rejects.toMatchObject({
        reason: "issued_document.not_found",
      });
    });
  });

  it("revokes once, with a reason, and the page and lists say so", async () => {
    await seeded(async (tx) => {
      const { service, repository } = serviceOn(tx);
      const { id, code } = await issueFor(tx);
      await expect(service.revoke({ actorId: STAFF, documentId: id, reason: "  " })).rejects.toMatchObject({
        reason: "issued_document.revocation_reason_required",
      });
      await service.revoke({ actorId: STAFF, documentId: id, reason: "Nombre mal escrito" });
      await expect(service.revoke({ actorId: STAFF, documentId: id, reason: "otra vez" })).rejects.toMatchObject({
        reason: "issued_document.already_revoked",
      });

      expect(await service.verify(code)).toMatchObject({ status: "revoked", revokedAt: expect.any(Date) });
      expect((await repository.listForStudents([ID(21)]))[0]).toMatchObject({ id, status: "revoked" });
      const [entry] = await tx
        .select({ metadata: auditLog.metadata })
        .from(auditLog)
        .where(and(eq(auditLog.action, "issued_document.revoked"), eq(auditLog.targetId, id)));
      // Ids only: the reason is free text about a person.
      expect(entry!.metadata).toMatchObject({ kind: "certificate", studentId: ID(21), enrollmentId: PASSED });
      expect(JSON.stringify(entry!.metadata)).not.toContain("Nombre mal");

      // The portal no longer prints it; staff still does.
      await expect(service.download({ actorId: ACCOUNT, documentId: id, portalAccount: true })).rejects.toMatchObject({
        reason: "issued_document.not_found",
      });
      await expect(service.download({ actorId: STAFF, documentId: id, portalAccount: false })).resolves.toMatchObject({ code });
    });
  });

  it("issues the certificate again in place of the revoked one, which then reads as replaced", async () => {
    await seeded(async (tx) => {
      const { service } = serviceOn(tx);
      const first = await issueFor(tx);
      await service.revoke({ actorId: STAFF, documentId: first.id, reason: "Nombre mal escrito" });

      const preview = await service.previewCertificates({ classGroupId: GROUP, moduleId: MODULE_2 });
      expect(reasonOf(preview.items, PASSED)).toBeNull();

      const second = await issueFor(tx);
      expect(second.id).not.toBe(first.id);
      const [row] = await tx.select().from(issuedDocuments).where(eq(issuedDocuments.id, second.id));
      expect(row!.replacesId).toBe(first.id);

      expect(await service.verify(first.code)).toMatchObject({ status: "replaced" });
      expect(await service.verify(second.code)).toMatchObject({ status: "valid" });
      const again = await service.previewCertificates({ classGroupId: GROUP, moduleId: MODULE_2 });
      expect(reasonOf(again.items, PASSED)).toBe("already_issued");
    });
  });

  it("prints the validation address and its QR in the frame", async () => {
    await seeded(async (tx) => {
      const { id, code } = await issueFor(tx);
      printed.length = 0;
      await serviceOn(tx).service.download({ actorId: STAFF, documentId: id, portalAccount: false });
      // The footer prints the page to type the code into; the QR carries the code itself.
      expect(printed[0]).toContain(`${code}\\a Verifíquelo en portal.test/verificar"`);
      const qr = /url\("data:image\/svg\+xml;base64,([^"]+)"\)/.exec(printed[0]!);
      expect(qr).not.toBeNull();
      expect(Buffer.from(qr![1]!, "base64").toString()).toContain("<svg");
    });
  });
});
