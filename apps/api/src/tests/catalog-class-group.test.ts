import {
  AcademicPeriod,
  AdvanceClassGroupStatusUseCase,
  CapacityBelowSeatsTakenError,
  ClassGroup,
  ClassGroupCourseLockedError,
  ClassGroupIncompleteError,
  ClassGroupTeacherLanguageError,
  ClassGroupTeacherUnavailableError,
  Course,
  CourseNotFoundError,
  CreateClassGroupUseCase,
  InvalidDateRangeError,
  InvalidStatusTransitionError,
  Teacher,
  UpdateClassGroupUseCase,
  type CreateClassGroupDTO,
  type CreateTeacherDTO,
} from "@ooc/domain";
import { beforeEach, describe, expect, it } from "vitest";
import {
  FakeAcademicPeriodRepository,
  FakeAuditLogRepository,
  FakeClassGroupRepository,
  FakeCourseRepository,
} from "./fakes/catalog.js";
import { FakeTeacherRepository } from "./fakes/teacher.js";

/**
 * A class group's life (OOC-35): born a draft, published once complete, moved
 * forward one step at a time by a person — never by a date. Capacity never
 * drops below the seats already taken; the course only changes while nothing
 * hangs off it.
 */

const ACTOR = "usr_coord";
let courses: FakeCourseRepository;
let periods: FakeAcademicPeriodRepository;
let groups: FakeClassGroupRepository;
let auditLog: FakeAuditLogRepository;
let teachers: FakeTeacherRepository;
let course: Course;
let period: AcademicPeriod;

function draftOf(overrides: Partial<CreateClassGroupDTO> = {}): CreateClassGroupDTO {
  return {
    courseId: course.id,
    academicPeriodId: period.id,
    code: "ING-0101",
    slots: [{ weekday: "mon", startTime: "18:00", endTime: "19:30" }],
    capacity: 30,
    ...overrides,
  };
}

function teacherOf(overrides: Partial<CreateTeacherDTO> = {}): Teacher {
  return Teacher.create({
    firstName: "Ana",
    lastName: "Torres",
    nationalIdType: "DNI",
    nationalId: "12345678",
    email: "ana@example.com",
    phone: "+51900000000",
    nationality: "PE",
    country: "PE",
    region: "Lima",
    city: "Lima",
    addressLine: "Av. Prueba 123",
    languages: ["Inglés"],
    availability: [],
    ...overrides,
  });
}

const DATES = {
  startsOn: new Date("2026-11-02T05:00:00Z"),
  endsOn: new Date("2027-01-30T05:00:00Z"),
};

beforeEach(async () => {
  courses = new FakeCourseRepository();
  periods = new FakeAcademicPeriodRepository();
  groups = new FakeClassGroupRepository();
  auditLog = new FakeAuditLogRepository();
  teachers = new FakeTeacherRepository();
  course = await courses.create(
    Course.create({
      name: "Inglés Básico", language: "Inglés", level: "A1", summary: "x", minAge: 13, modules: 4,
      totalHours: 80, certificateRule: "automatic", allowsFreeze: true, allowsTransfer: false,
    }),
  );
  period = await periods.create(AcademicPeriod.create({ name: "Ciclo 2026-IV", ...DATES }));
});

describe("CreateClassGroupUseCase", () => {
  const create = () => new CreateClassGroupUseCase(courses, periods, groups, teachers, auditLog);

  it("creates a draft without dates", async () => {
    const group = await create().run({ actorId: ACTOR, classGroup: draftOf(), publish: false });
    expect(group.status).toBe("draft");
    expect(group.startsOn).toBeNull();
    expect(group.seatsTaken).toBe(0);
    expect(auditLog.appended.map((entry) => entry.action)).toEqual(["catalog.class_group.created"]);
  });

  it("publishes straight away when complete", async () => {
    const group = await create().run({ actorId: ACTOR, classGroup: draftOf(DATES), publish: true });
    expect(group.status).toBe("enrolling");
  });

  it("refuses to publish without dates", async () => {
    await expect(create().run({ actorId: ACTOR, classGroup: draftOf(), publish: true })).rejects.toBeInstanceOf(
      ClassGroupIncompleteError,
    );
  });

  it("refuses a retired course", async () => {
    course.softDelete();
    await expect(create().run({ actorId: ACTOR, classGroup: draftOf(), publish: false })).rejects.toBeInstanceOf(
      CourseNotFoundError,
    );
  });

  it("refuses an end before the start", async () => {
    await expect(
      create().run({ actorId: ACTOR, classGroup: draftOf({ startsOn: DATES.endsOn, endsOn: DATES.startsOn }), publish: false }),
    ).rejects.toBeInstanceOf(InvalidDateRangeError);
  });

  it("refuses an enrollment window that closes before it opens", async () => {
    await expect(
      create().run({
        actorId: ACTOR,
        classGroup: draftOf({ enrollmentOpensAt: DATES.endsOn, enrollmentClosesAt: DATES.startsOn }),
        publish: false,
      }),
    ).rejects.toBeInstanceOf(InvalidDateRangeError);
  });
});

describe("AdvanceClassGroupStatusUseCase", () => {
  it("walks the whole life one step at a time", async () => {
    const group = await groups.create(ClassGroup.create(draftOf(DATES)));
    const advance = new AdvanceClassGroupStatusUseCase(groups, auditLog);

    for (const to of ["enrolling", "in_progress", "finished", "closed"] as const) {
      expect((await advance.run({ actorId: ACTOR, id: group.id, to })).status).toBe(to);
    }
    expect(auditLog.appended.at(-1)).toEqual(
      expect.objectContaining({ action: "catalog.class_group.status_changed", metadata: { from: "finished", to: "closed" } }),
    );
  });

  it("refuses skipping a step or going back", async () => {
    const group = await groups.create(ClassGroup.create(draftOf(DATES)));
    const advance = new AdvanceClassGroupStatusUseCase(groups, auditLog);

    await expect(advance.run({ actorId: ACTOR, id: group.id, to: "in_progress" })).rejects.toBeInstanceOf(
      InvalidStatusTransitionError,
    );
    await advance.run({ actorId: ACTOR, id: group.id, to: "enrolling" });
    await expect(advance.run({ actorId: ACTOR, id: group.id, to: "draft" })).rejects.toBeInstanceOf(
      InvalidStatusTransitionError,
    );
  });
});

describe("UpdateClassGroupUseCase", () => {
  it("refuses a capacity below the seats taken", async () => {
    const group = await groups.create(ClassGroup.create(draftOf(DATES)));
    groups.seatsTakenOverride.set(group.id, 12);

    await expect(
      new UpdateClassGroupUseCase(courses, groups, teachers, auditLog).run({ actorId: ACTOR, id: group.id, patch: { capacity: 10 } }),
    ).rejects.toBeInstanceOf(CapacityBelowSeatsTakenError);
  });

  it("changes the course only on a draft", async () => {
    const other = await courses.create(Course.create({
        name: "Inglés Kids", language: "Inglés", level: "Kids", summary: "x", minAge: 7, modules: 4,
        totalHours: 80, certificateRule: "automatic", allowsFreeze: true, allowsTransfer: false,
      }));
    const group = await groups.create(ClassGroup.create(draftOf(DATES)));
    const update = new UpdateClassGroupUseCase(courses, groups, teachers, auditLog);

    await update.run({ actorId: ACTOR, id: group.id, patch: { courseId: other.id } });
    expect(groups.rows.get(group.id)?.courseId).toBe(other.id);

    await new AdvanceClassGroupStatusUseCase(groups, auditLog).run({ actorId: ACTOR, id: group.id, to: "enrolling" });
    await expect(update.run({ actorId: ACTOR, id: group.id, patch: { courseId: course.id } })).rejects.toBeInstanceOf(
      ClassGroupCourseLockedError,
    );
  });

  it("refuses clearing the dates of a published class group", async () => {
    const group = await groups.create(ClassGroup.create(draftOf(DATES)));
    await new AdvanceClassGroupStatusUseCase(groups, auditLog).run({ actorId: ACTOR, id: group.id, to: "enrolling" });

    await expect(
      new UpdateClassGroupUseCase(courses, groups, teachers, auditLog).run({ actorId: ACTOR, id: group.id, patch: { startsOn: null } }),
    ).rejects.toBeInstanceOf(ClassGroupIncompleteError);
  });
});

describe("Allocating a teacher (OOC-80)", () => {
  const create = () => new CreateClassGroupUseCase(courses, periods, groups, teachers, auditLog);
  const update = () => new UpdateClassGroupUseCase(courses, groups, teachers, auditLog);

  it("writes the teacher from the roster on create and audits who", async () => {
    const ana = await teachers.create(teacherOf());
    const group = await create().run({ actorId: ACTOR, classGroup: draftOf({ teacherId: ana.id }), publish: false });

    expect(groups.rows.get(group.id)?.teacherId).toBe(ana.id);
    expect(auditLog.appended.at(-1)?.metadata).toEqual(expect.objectContaining({ teacherId: ana.id }));
  });

  it("opens a class group with nobody allocated yet", async () => {
    const group = await create().run({ actorId: ACTOR, classGroup: draftOf(), publish: false });
    expect(group.teacherId).toBeNull();
  });

  it("refuses a teacher who is not on the roster", async () => {
    const gone = teacherOf();
    gone.leaveRoster();
    await teachers.create(gone);

    for (const teacherId of [gone.id, "018f2b5c-9000-7000-8000-00000000ffff"]) {
      await expect(
        create().run({ actorId: ACTOR, classGroup: draftOf({ teacherId }), publish: false }),
      ).rejects.toBeInstanceOf(ClassGroupTeacherUnavailableError);
    }
  });

  it("refuses a teacher who does not teach the course's language", async () => {
    const luis = await teachers.create(teacherOf({ nationalId: "87654321", languages: ["Italiano"] }));
    await expect(
      create().run({ actorId: ACTOR, classGroup: draftOf({ teacherId: luis.id }), publish: false }),
    ).rejects.toBeInstanceOf(ClassGroupTeacherLanguageError);
  });

  it("matches the language whatever its case", async () => {
    const ana = await teachers.create(teacherOf({ languages: [" inglés "] }));
    const group = await create().run({ actorId: ACTOR, classGroup: draftOf({ teacherId: ana.id }), publish: false });
    expect(group.teacherId).toBe(ana.id);
  });

  it("allocates on edit, clears the typed name, and audits the field", async () => {
    const ana = await teachers.create(teacherOf());
    const legacy = new ClassGroup({ ...ClassGroup.create(draftOf()), legacyTeacherName: "Ana T." });
    await groups.create(legacy);

    await update().run({ actorId: ACTOR, id: legacy.id, patch: { teacherId: ana.id } });

    const saved = groups.rows.get(legacy.id)!;
    expect(saved.teacherId).toBe(ana.id);
    expect(saved.legacyTeacherName).toBe("");
    expect(auditLog.appended.at(-1)?.metadata).toEqual({ fields: ["teacherId"], teacherId: ana.id });
  });

  it("takes the allocation away with null", async () => {
    const ana = await teachers.create(teacherOf());
    const group = await groups.create(ClassGroup.create(draftOf({ teacherId: ana.id })));

    await update().run({ actorId: ACTOR, id: group.id, patch: { teacherId: null } });
    expect(groups.rows.get(group.id)?.teacherId).toBeNull();
  });

  it("never re-checks an untouched allocation — a teacher who left mid-cycle keeps the class group editable", async () => {
    const ana = await teachers.create(teacherOf());
    const group = await groups.create(ClassGroup.create(draftOf({ teacherId: ana.id })));
    const left = (await teachers.findById(ana.id))!;
    left.leaveRoster();
    await teachers.update(left);

    await update().run({ actorId: ACTOR, id: group.id, patch: { capacity: 25 } });
    expect(groups.rows.get(group.id)?.capacity).toBe(25);
  });

  it("re-checks the allocated teacher against a new course", async () => {
    const italian = await courses.create(
      Course.create({
        name: "Italiano Básico", language: "Italiano", level: "A1", summary: "x", minAge: 13, modules: 4,
        totalHours: 80, certificateRule: "automatic", allowsFreeze: true, allowsTransfer: false,
      }),
    );
    const ana = await teachers.create(teacherOf());
    const group = await groups.create(ClassGroup.create(draftOf({ teacherId: ana.id })));

    await expect(
      update().run({ actorId: ACTOR, id: group.id, patch: { courseId: italian.id } }),
    ).rejects.toBeInstanceOf(ClassGroupTeacherLanguageError);
  });
});
