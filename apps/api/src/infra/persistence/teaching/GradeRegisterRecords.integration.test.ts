import * as schema from "@ooc/db";
import {
  academicPeriods,
  auditLog,
  classGroupModules,
  classGroups,
  courses,
  documentTemplateVersions,
  enrollments,
  gradeCorrections,
  gradeRegisterEvents,
  gradeRegisterRecords,
  gradeRegisters,
  grades,
  planPrices,
  plans,
  students,
  teachers,
} from "@ooc/db";
import { DocumentTemplateNotPublishedError } from "@ooc/domain";
import { TemplateEngine } from "@ooc/templates";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/infra/db/client.js";
import { DocumentPreviewService } from "@/documents/DocumentPreviewService.js";
import { DOCUMENT_KINDS, DocumentTemplateCompiler } from "@/documents/documentKinds.js";
import { GradeRegisterRecordNotFoundError, GradeRegisterRecordService } from "@/documents/GradeRegisterRecordService.js";
import { DrizzleAuditLogRepository } from "@/infra/identity/DrizzleAuditLogRepository.js";
import { DrizzleDocumentTemplateRepository } from "@/infra/persistence/document/DrizzleDocumentTemplateRepository.js";
import { DrizzlePlatformSettingsRepository } from "@/infra/persistence/platform/DrizzlePlatformSettingsRepository.js";
import { DrizzleTeacherRepository } from "@/infra/persistence/teacher/DrizzleTeacherRepository.js";
import { DrizzleGradeRegisterRecordRepository } from "./DrizzleGradeRegisterRecordRepository.js";

/**
 * The teacher's acta de notas (OOC-176) against Postgres: only an official
 * register has one, the counts come from the current grades (a correction
 * after official included), the first download records it with the frozen
 * teacher and the template version, and the teacher portal reaches only the
 * teacher's own. The PDF renderer is a stub; the template engine is real.
 *
 * Every test runs in a transaction that is always rolled back.
 */

const { Pool } = pg;
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is required: this suite exercises the actas de notas against a real, migrated Postgres.");
}

const ID = (n: number) => `018f2b5c-9176-7000-8000-${String(n).padStart(12, "0")}`;
const STAFF = "ooc176-staff";
const TEACHER_ACCOUNT = "ooc176-teacher-account";
const OTHER_TEACHER_ACCOUNT = "ooc176-other-teacher";
const PERIOD = ID(1);
const COURSE = ID(2);
const PLAN = ID(3);
const PLAN_PRICE = ID(4);
const GROUP = ID(5);
const MODULE_1 = ID(6);
const MODULE_2 = ID(7);
const TEACHER = ID(8);
const OTHER_TEACHER = ID(9);
const OFFICIAL = ID(30);
const IN_REVIEW = ID(31);
const CONFIRMED_AT = new Date("2026-11-16T15:00:00.000Z");

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

function serviceOn(tx: Db): GradeRegisterRecordService {
  const templates = new DrizzleDocumentTemplateRepository(tx);
  const teacherRepository = new DrizzleTeacherRepository(tx);
  const preview = new DocumentPreviewService(
    new TemplateEngine(),
    renderer,
    new DocumentTemplateCompiler(new TemplateEngine()),
    templates,
    teacherRepository,
  );
  return new GradeRegisterRecordService(
    preview,
    templates,
    new DrizzleGradeRegisterRecordRepository(tx),
    teacherRepository,
    new DrizzlePlatformSettingsRepository(tx),
    new DrizzleAuditLogRepository(tx),
  );
}

async function seeded(body: (tx: Db) => Promise<void>, options: { publish?: boolean } = {}): Promise<void> {
  try {
    await db.transaction(async (raw: Tx) => {
      const tx = raw as unknown as Db;
      await seed(tx, options.publish ?? true);
      await body(tx);
      throw new RolledBack();
    });
  } catch (error) {
    if (!(error instanceof RolledBack)) throw error;
  }
}

async function seed(tx: Db, publish: boolean): Promise<void> {
  await tx.execute(
    sql`insert into "user" ("id", "name", "email", "emailVerified", "role", "createdAt", "updatedAt")
        values (${STAFF}, 'Milagros Coordinación', 'ooc176.staff@test.local', true, 'admin', now(), now()),
               (${TEACHER_ACCOUNT}, 'Ana', 'ooc176.teacher@test.local', true, 'teacher', now(), now()),
               (${OTHER_TEACHER_ACCOUNT}, 'Otro', 'ooc176.other@test.local', true, 'teacher', now(), now())`,
  );
  await tx.insert(teachers).values([
    {
      id: TEACHER,
      firstName: "Ana",
      lastName: "Quispe",
      email: "ooc176.teacher@test.local",
      nationalIdType: "DNI",
      nationalId: "91760001",
      phone: "+51900000000",
      nationality: "PE",
      addressLine: "Av. Siempre Viva 1",
      city: "Lima",
      country: "PE",
      userId: TEACHER_ACCOUNT,
    },
    { id: OTHER_TEACHER, firstName: "Otro", lastName: "Docente", email: "ooc176.other@test.local", userId: OTHER_TEACHER_ACCOUNT },
  ]);
  await tx.insert(academicPeriods).values({
    id: PERIOD,
    name: "Ciclo OOC-176",
    startsOn: new Date("2026-08-01T05:00:00.000Z"),
    endsOn: new Date("2026-12-31T05:00:00.000Z"),
  });
  await tx.insert(courses).values({ id: COURSE, name: "Inglés OOC-176", language: "Inglés", minAge: 12, level: "A1", modules: 2 });
  await tx.insert(plans).values({ id: PLAN, courseId: COURSE, name: "Paquete" });
  await tx.insert(planPrices).values({ id: PLAN_PRICE, planId: PLAN, amountCents: 20000 });
  await tx.insert(classGroups).values({
    id: GROUP,
    courseId: COURSE,
    academicPeriodId: PERIOD,
    schedule: "",
    code: "A-91760",
    startsOn: new Date("2026-08-03T05:00:00.000Z"),
    endsOn: new Date("2026-11-13T05:00:00.000Z"),
    capacity: 30,
    seatsTaken: 4,
    status: "closed",
  });
  const slots = [{ weekday: "mon", startTime: "19:00", endTime: "20:30" }];
  await tx.insert(classGroupModules).values([
    { id: MODULE_1, classGroupId: GROUP, module: 1, slots, teacherId: TEACHER },
    { id: MODULE_2, classGroupId: GROUP, module: 2, slots, teacherId: OTHER_TEACHER },
  ]);
  await tx.insert(gradeRegisters).values([
    { id: OFFICIAL, classGroupId: GROUP, classGroupModuleId: MODULE_1, round: 1, status: "official" },
    { id: IN_REVIEW, classGroupId: GROUP, classGroupModuleId: MODULE_2, round: 1, status: "in_review" },
  ]);
  await tx.insert(gradeRegisterEvents).values([
    { registerId: OFFICIAL, kind: "submitted", actorId: TEACHER_ACCOUNT, createdAt: new Date("2026-11-15T15:00:00.000Z") },
    { registerId: OFFICIAL, kind: "confirmed", actorId: STAFF, createdAt: CONFIRMED_AT },
    { registerId: IN_REVIEW, kind: "submitted", actorId: OTHER_TEACHER_ACCOUNT },
  ]);

  // Module 1, official: 16 and 14 pass (14 is the minimum), 12 fails, one DA.
  const values: (number | "da")[] = [16, 14, 12, "da"];
  for (const [index, value] of values.entries()) {
    const n = 20 + index;
    await tx.insert(students).values({
      id: ID(n),
      firstName: `Nombre${n}`,
      lastName: `Apellido${n}`,
      nationalIdType: "DNI",
      nationalId: `9176${n}00`,
      email: `ooc176.${n}@gmail.com`,
      phone: "+51900000000",
      birthDate: new Date("2000-01-01T00:00:00.000Z"),
      country: "PE",
      city: "Lima",
    });
    await tx.insert(enrollments).values({
      id: ID(40 + index),
      studentId: ID(n),
      classGroupId: GROUP,
      classGroupModuleId: MODULE_2,
      planPriceId: PLAN_PRICE,
      seatStatus: "confirmed",
    });
    await tx.insert(grades).values({
      id: ID(60 + index),
      enrollmentId: ID(40 + index),
      classGroupId: GROUP,
      classGroupModuleId: MODULE_1,
      attempt: 1,
      score: value === "da" ? null : value,
      didNotSit: value === "da",
      recordedBy: TEACHER_ACCOUNT,
      registerId: OFFICIAL,
    });
  }

  if (publish) {
    await tx.insert(documentTemplateVersions).values({
      kind: "grade_register_record",
      version: 1,
      body: DOCUMENT_KINDS.grade_register_record.starterBody,
      publishedBy: STAFF,
    });
  }
}

describe("the actas de notas (OOC-176)", () => {
  it("lists only official registers, with the counts of their grades", async () => {
    await seeded(async (tx) => {
      const items = await serviceOn(tx).list({ academicPeriodId: null, teacherId: null });
      const mine = items.filter((item) => item.classGroupId === GROUP);
      expect(mine.map((item) => item.registerId)).toEqual([OFFICIAL]);
      expect(mine[0]).toMatchObject({
        classGroupCode: "A-91760",
        module: 1,
        teacherId: TEACHER,
        teacherName: "Ana Quispe",
        confirmedByName: "Milagros Coordinación",
        students: 4,
        passed: 2,
        failed: 1,
        didNotSit: 1,
        correctedAt: null,
        record: null,
      });
    });
  });

  it("records the acta on the first download, frozen, and prints the same record after", async () => {
    await seeded(async (tx) => {
      const service = serviceOn(tx);
      printed.length = 0;
      const first = await service.download({ actorId: STAFF, registerId: OFFICIAL });
      expect(first.fileName).toBe("acta-A-91760-m1.pdf");
      expect(printed[0]).toContain("Ana Quispe");
      expect(printed[0]).toContain("Aprobados (nota mínima 14): 2");
      expect(printed[0]).not.toContain("Acta corregida");

      const [record] = await tx.select().from(gradeRegisterRecords).where(eq(gradeRegisterRecords.registerId, OFFICIAL));
      expect(record).toMatchObject({ teacherId: TEACHER, recordedBy: STAFF });
      expect(record!.data).toMatchObject({
        teacher: { fullName: "Ana Quispe", documentType: "DNI", nationalId: "91760001" },
        module: { number: 1, label: "Módulo 1", round: 1 },
        confirmed: { byName: "Milagros Coordinación", on: "2026-11-16" },
      });

      // The teacher's file changes; the acta keeps the name it was recorded with.
      await tx.update(teachers).set({ lastName: "Quispe Peña" }).where(eq(teachers.id, TEACHER));
      await service.download({ actorId: STAFF, registerId: OFFICIAL });
      expect(printed[1]).toContain("<strong>Ana Quispe</strong>");
      expect(await tx.select().from(gradeRegisterRecords).where(eq(gradeRegisterRecords.registerId, OFFICIAL))).toHaveLength(1);

      const audits = await tx.select().from(auditLog).where(eq(auditLog.action, "grade_register_record.downloaded"));
      expect(audits.map((entry) => (entry.metadata as { firstDownload: boolean }).firstDownload)).toEqual([true, false]);
    });
  });

  it("shows today's numbers and the correction day after a grade is corrected past official", async () => {
    await seeded(async (tx) => {
      await tx.insert(gradeCorrections).values({
        gradeId: ID(62),
        score: 15,
        didNotSit: false,
        kind: "correction",
        reason: "Error de digitación",
        correctedBy: STAFF,
        createdAt: new Date("2026-11-20T15:00:00.000Z"),
      });
      printed.length = 0;
      await serviceOn(tx).download({ actorId: STAFF, registerId: OFFICIAL });
      expect(printed[0]).toContain("Aprobados (nota mínima 14): 3");
      expect(printed[0]).toContain("Desaprobados: 0");
      expect(printed[0]).toContain("Acta corregida el 20 de noviembre de 2026");
    });
  });

  it("has no acta for a register still open", async () => {
    await seeded(async (tx) => {
      await expect(serviceOn(tx).download({ actorId: STAFF, registerId: IN_REVIEW })).rejects.toBeInstanceOf(
        GradeRegisterRecordNotFoundError,
      );
    });
  });

  it("records nothing while the acta's template has no published version", async () => {
    await seeded(
      async (tx) => {
        await expect(serviceOn(tx).download({ actorId: STAFF, registerId: OFFICIAL })).rejects.toBeInstanceOf(
          DocumentTemplateNotPublishedError,
        );
        expect(await tx.select().from(gradeRegisterRecords).where(eq(gradeRegisterRecords.registerId, OFFICIAL))).toEqual([]);
      },
      { publish: false },
    );
  });

  it("hands the teacher their own actas and nobody else's", async () => {
    await seeded(async (tx) => {
      const service = serviceOn(tx);
      expect((await service.listOwn(TEACHER_ACCOUNT)).map((item) => item.registerId)).toEqual([OFFICIAL]);
      expect(await service.listOwn(OTHER_TEACHER_ACCOUNT)).toEqual([]);
      expect(await service.listOwn(STAFF)).toEqual([]);

      await service.download({ actorId: TEACHER_ACCOUNT, registerId: OFFICIAL, teacherUserId: TEACHER_ACCOUNT });
      await expect(
        service.download({ actorId: OTHER_TEACHER_ACCOUNT, registerId: OFFICIAL, teacherUserId: OTHER_TEACHER_ACCOUNT }),
      ).rejects.toBeInstanceOf(GradeRegisterRecordNotFoundError);
    });
  });

  it("keeps the acta with its recorded teacher after the run is handed to somebody else", async () => {
    await seeded(async (tx) => {
      const service = serviceOn(tx);
      await service.download({ actorId: STAFF, registerId: OFFICIAL });
      await tx.update(classGroupModules).set({ teacherId: OTHER_TEACHER }).where(eq(classGroupModules.id, MODULE_1));

      expect((await service.listOwn(TEACHER_ACCOUNT)).map((item) => item.registerId)).toEqual([OFFICIAL]);
      expect(await service.listOwn(OTHER_TEACHER_ACCOUNT)).toEqual([]);
    });
  });
});
