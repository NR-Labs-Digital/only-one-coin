import {
  Course,
  CourseNotFoundError,
  CreateCourseUseCase,
  LandingKeyTakenError,
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

const A_COURSE: CreateCourseDTO = {
  name: "Inglés Básico",
  language: "Inglés",
  level: "A1",
  summary: "Curso de inglés para principiantes.",
  minAge: 13,
  modules: 4,
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
