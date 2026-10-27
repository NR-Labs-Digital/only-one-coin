import {
  Course,
  CourseNotFoundError,
  CreateCourseUseCase,
  LandingKeyTakenError,
  ModuleMaterialInvalidError,
  ModuleMaterialsIncompleteError,
  UpdateCourseUseCase,
  type CreateCourseDTO,
} from "@ooc/domain";
import { ZodError } from "zod";
import { beforeEach, describe, expect, it } from "vitest";
import { FakeAuditLogRepository, FakeCourseRepository } from "./fakes/catalog.js";

/**
 * Opening and changing a course (OOC-36). Pure domain — fakes, no database.
 * What matters: the invariants live on the entity, every write leaves an audit
 * line, and an update reports only what actually changed.
 */

const ACTOR = "usr_admin";

const LINKS = [
  "https://drive.google.com/drive/folders/m1",
  "https://drive.google.com/drive/folders/m2",
  "https://docs.google.com/presentation/d/m3",
  "https://drive.google.com/drive/folders/m4",
];

const A_COURSE: CreateCourseDTO = {
  name: "Inglés Básico",
  language: "Inglés",
  level: "A1",
  summary: "Curso de inglés para principiantes.",
  minAge: 13,
  modules: 4,
  moduleMaterials: LINKS,
  totalHours: 80,
  certificateRule: "automatic",
  allowsFreeze: true,
  allowsTransfer: false,
};

let courses: FakeCourseRepository;
let auditLog: FakeAuditLogRepository;

beforeEach(() => {
  courses = new FakeCourseRepository();
  auditLog = new FakeAuditLogRepository();
});

describe("CreateCourseUseCase", () => {
  it("creates the course and audits it", async () => {
    const created = await new CreateCourseUseCase(courses, auditLog).run({ actorId: ACTOR, course: A_COURSE });

    expect(created.name).toBe("Inglés Básico");
    expect(created.deletedAt).toBeNull();
    expect(courses.rows.get(created.id)).toBe(created);
    expect(auditLog.appended).toEqual([
      expect.objectContaining({ actorId: ACTOR, action: "catalog.course.created", targetId: created.id }),
    ]);
  });

  it("refuses a minimum age of zero", () => {
    expect(() => Course.create({ ...A_COURSE, minAge: 0 })).toThrow(ZodError);
  });

  it("opens a course without a summary (OOC-107)", () => {
    const { summary: _summary, ...withoutSummary } = A_COURSE;
    expect(Course.create(withoutSummary).summary).toBe("");
  });
});

describe("UpdateCourseUseCase", () => {
  it("applies the patch and audits the changed fields only", async () => {
    const course = await courses.create(Course.create(A_COURSE));

    const updated = await new UpdateCourseUseCase(courses, auditLog).run({
      actorId: ACTOR,
      id: course.id,
      patch: { minAge: 15, modules: 4 },
    });

    expect(updated.minAge).toBe(15);
    expect(auditLog.appended).toEqual([
      expect.objectContaining({
        action: "catalog.course.updated",
        targetId: course.id,
        metadata: { fields: ["minAge"] },
      }),
    ]);
  });

  it("writes nothing when nothing changed", async () => {
    const course = await courses.create(Course.create(A_COURSE));

    await new UpdateCourseUseCase(courses, auditLog).run({ actorId: ACTOR, id: course.id, patch: { modules: 4 } });

    expect(auditLog.appended).toEqual([]);
  });

  it("answers 404 for a course not on file", async () => {
    await expect(
      new UpdateCourseUseCase(courses, auditLog).run({ actorId: ACTOR, id: "018f2b5c-0000-7000-8000-0000000000ff", patch: { minAge: 15 } }),
    ).rejects.toBeInstanceOf(CourseNotFoundError);
  });
});

/**
 * The language is free text and the catalog groups by its spelling, so
 * "INGLES" next to "Inglés" opened a second English on the courses screen and
 * in the checkout. A language already in use is written the way it already is.
 */
describe("language spelling", () => {
  it("opens a course on the spelling already in use", async () => {
    await courses.create(Course.create(A_COURSE));

    const kids = await new CreateCourseUseCase(courses, auditLog).run({
      actorId: ACTOR,
      course: { ...A_COURSE, name: "INGLES KIDS", language: " INGLES " },
    });

    expect(kids.language).toBe("Inglés");
  });

  it("takes the spelling most courses use", async () => {
    await courses.create(Course.create({ ...A_COURSE, language: "FRANCÉS" }));
    await courses.create(Course.create({ ...A_COURSE, language: "Francés" }));
    await courses.create(Course.create({ ...A_COURSE, language: "Francés" }));

    const created = await new CreateCourseUseCase(courses, auditLog).run({
      actorId: ACTOR,
      course: { ...A_COURSE, language: "frances" },
    });

    expect(created.language).toBe("Francés");
  });

  it("ignores retired courses", async () => {
    const retired = Course.create({ ...A_COURSE, language: "INGLES" });
    retired.softDelete();
    await courses.create(retired);

    const created = await new CreateCourseUseCase(courses, auditLog).run({ actorId: ACTOR, course: A_COURSE });

    expect(created.language).toBe("Inglés");
  });

  it("keeps a new language as typed", async () => {
    await courses.create(Course.create(A_COURSE));

    const created = await new CreateCourseUseCase(courses, auditLog).run({
      actorId: ACTOR,
      course: { ...A_COURSE, language: "Quechua" },
    });

    expect(created.language).toBe("Quechua");
  });

  it("moves a course into a language on the spelling already in use", async () => {
    await courses.create(Course.create(A_COURSE));
    const italian = await courses.create(Course.create({ ...A_COURSE, language: "Italiano" }));

    const updated = await new UpdateCourseUseCase(courses, auditLog).run({
      actorId: ACTOR,
      id: italian.id,
      patch: { language: "INGLES" },
    });

    expect(updated.language).toBe("Inglés");
  });

  it("lets a course correct the spelling of the language it is in", async () => {
    const kids = await courses.create(Course.create({ ...A_COURSE, language: "INGLES" }));
    await courses.create(Course.create({ ...A_COURSE, language: "INGLES" }));

    const updated = await new UpdateCourseUseCase(courses, auditLog).run({
      actorId: ACTOR,
      id: kids.id,
      patch: { language: "Inglés" },
    });

    expect(updated.language).toBe("Inglés");
    expect(auditLog.appended.at(-1)?.metadata).toEqual({ fields: ["language"] });
  });
});

/**
 * One material link per module (OOC-94): required when a course opens and
 * whenever its modules change. A course written before OOC-94 has none and
 * stays editable — it warns, it does not lock.
 */
describe("module materials", () => {
  it("refuses a course with fewer links than modules", () => {
    expect(() => Course.create({ ...A_COURSE, moduleMaterials: LINKS.slice(0, 3) })).toThrow(
      ModuleMaterialsIncompleteError,
    );
  });

  it.each([
    "http://drive.google.com/x",
    "https://drive.google.com.evil.com/x",
    "https://evil.com/?u=drive.google.com",
    "javascript:alert(1)",
    "",
  ])("refuses %s as a module material", (bad) => {
    expect(() => Course.create({ ...A_COURSE, moduleMaterials: [bad, ...LINKS.slice(1)] })).toThrow(
      ModuleMaterialInvalidError,
    );
  });

  it("normalizes the links it keeps", () => {
    const course = Course.create({ ...A_COURSE, moduleMaterials: ["  https://DRIVE.GOOGLE.COM/x ", ...LINKS.slice(1)] });
    expect(course.moduleMaterials).toEqual(["https://drive.google.com/x", ...LINKS.slice(1)]);
  });

  // A course written before OOC-94: a module count, no links.
  const legacy = () => courses.create(new Course({ ...Course.create(A_COURSE), moduleMaterials: [] }));
  const full = () => courses.create(Course.create(A_COURSE));
  const update = (id: string, patch: Parameters<UpdateCourseUseCase["run"]>[0]["patch"]) =>
    new UpdateCourseUseCase(courses, auditLog).run({ actorId: ACTOR, id, patch });

  it("lets a course without materials change another option", async () => {
    const course = await legacy();
    const updated = await update(course.id, { minAge: 15 });
    expect(updated.minAge).toBe(15);
    expect(auditLog.appended.map((entry) => entry.metadata)).toEqual([{ fields: ["minAge"] }]);
  });

  it("does not ask for links when modules is resent unchanged", async () => {
    const course = await legacy();
    const updated = await update(course.id, { minAge: 15, modules: 4 });
    expect(updated.minAge).toBe(15);
  });

  it("refuses a module count change without links", async () => {
    const course = await legacy();
    await expect(update(course.id, { modules: 3 })).rejects.toBeInstanceOf(ModuleMaterialsIncompleteError);
    expect(auditLog.appended).toEqual([]);
    expect(courses.rows.get(course.id)?.modules).toBe(4);
  });

  it("fills the materials of a course that had none", async () => {
    const course = await legacy();
    const updated = await update(course.id, { moduleMaterials: LINKS });
    expect(updated.moduleMaterials).toEqual(LINKS);
    expect(auditLog.appended.map((entry) => entry.metadata)).toEqual([{ fields: ["moduleMaterials"] }]);
  });

  it("drops the last module with its link", async () => {
    const course = await full();
    const updated = await update(course.id, { modules: 3, moduleMaterials: LINKS.slice(0, 3) });
    expect(updated.moduleMaterials).toEqual(LINKS.slice(0, 3));
    expect(auditLog.appended.map((entry) => entry.metadata)).toEqual([{ fields: ["modules", "moduleMaterials"] }]);
  });

  it("refuses fewer modules when the links are not resent", async () => {
    const course = await full();
    await expect(update(course.id, { modules: 3 })).rejects.toBeInstanceOf(ModuleMaterialsIncompleteError);
  });

  it("refuses an invalid link on update", async () => {
    const course = await full();
    await expect(update(course.id, { moduleMaterials: ["https://evil.com/x", ...LINKS.slice(1)] })).rejects.toBeInstanceOf(
      ModuleMaterialInvalidError,
    );
  });

  it("does not count the same links as a change", async () => {
    const course = await full();
    await update(course.id, { moduleMaterials: LINKS.map((link) => ` ${link} `) });
    expect(auditLog.appended).toEqual([]);
  });
});

/**
 * The landing's enroll buttons send a key, not an id (OOC-117). One live
 * course per key — otherwise the checkout would have to guess which course a
 * button meant.
 */
describe("landing key", () => {
  it("a course is born unlinked unless told otherwise", () => {
    expect(Course.create(A_COURSE).landingKey).toBeNull();
    expect(Course.create({ ...A_COURSE, landingKey: "english" }).landingKey).toBe("english");
  });

  it("refuses a key the landing does not have", () => {
    expect(() => Course.create({ ...A_COURSE, landingKey: "klingon" as never })).toThrow(ZodError);
  });

  it("refuses to open a course on a key another live course holds", async () => {
    await courses.create(Course.create({ ...A_COURSE, landingKey: "english" }));

    await expect(
      new CreateCourseUseCase(courses, auditLog).run({
        actorId: ACTOR,
        course: { ...A_COURSE, name: "Inglés Básico 2", landingKey: "english" },
      }),
    ).rejects.toBeInstanceOf(LandingKeyTakenError);
    expect(auditLog.appended).toEqual([]);
  });

  it("lets a new course take the key a retired course held", async () => {
    const retired = await courses.create(Course.create({ ...A_COURSE, landingKey: "english" }));
    retired.softDelete();

    const created = await new CreateCourseUseCase(courses, auditLog).run({
      actorId: ACTOR,
      course: { ...A_COURSE, landingKey: "english" },
    });

    expect(created.landingKey).toBe("english");
  });

  it("refuses to move a course onto a key another live course holds", async () => {
    await courses.create(Course.create({ ...A_COURSE, landingKey: "english" }));
    const other = await courses.create(Course.create({ ...A_COURSE, name: "Inglés Kids" }));

    await expect(
      new UpdateCourseUseCase(courses, auditLog).run({ actorId: ACTOR, id: other.id, patch: { landingKey: "english" } }),
    ).rejects.toBeInstanceOf(LandingKeyTakenError);
  });

  it("links, relinks and unlinks a course, auditing the field", async () => {
    const course = await courses.create(Course.create(A_COURSE));
    const update = new UpdateCourseUseCase(courses, auditLog);

    await update.run({ actorId: ACTOR, id: course.id, patch: { landingKey: "english-kids" } });
    // Saving the key the course already holds is not a conflict with itself.
    await update.run({ actorId: ACTOR, id: course.id, patch: { landingKey: "english-kids", minAge: 6 } });
    const unlinked = await update.run({ actorId: ACTOR, id: course.id, patch: { landingKey: null } });

    expect(unlinked.landingKey).toBeNull();
    expect(auditLog.appended.map((entry) => entry.metadata)).toEqual([
      { fields: ["landingKey"] },
      { fields: ["minAge"] },
      { fields: ["landingKey"] },
    ]);
  });
});
