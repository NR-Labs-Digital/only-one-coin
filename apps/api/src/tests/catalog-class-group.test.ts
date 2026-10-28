import {
  AcademicPeriod,
  AdvanceClassGroupStatusUseCase,
  CapacityBelowSeatsTakenError,
  ClassGroup,
  ClassGroupCourseLockedError,
  ClassGroupIncompleteError,
  ClassroomUrlInvalidError,
  ClassGroupModuleOutOfRangeError,
  ClassGroupTeacherLanguageError,
  ClassGroupTeacherUnavailableError,
  Course,
  CourseNotFoundError,
  CreateClassGroupUseCase,
  InvalidDateRangeError,
  InvalidStatusTransitionError,
  Teacher,
  UpdateClassGroupUseCase,
  classGroupCodeOf,
  materialOfModule,
  type CreateClassGroupDTO,
  type CreateTeacherDTO,
  type UpdateClassGroupDTO,
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
const CODE = "A-00001";
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
      name: "Inglés Básico", language: "Inglés", level: "A1", summary: "x", minAge: 13, modules: 4, moduleMaterials: Array(4).fill("https://drive.google.com/x"),
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

  it("stamps the next code from the sequence — nobody types it", async () => {
    const first = await create().run({ actorId: ACTOR, classGroup: draftOf(), publish: false });
    const second = await create().run({ actorId: ACTOR, classGroup: draftOf(), publish: false });
    expect(first.code).toBe("A-00001");
    expect(second.code).toBe("A-00002");
  });

  it("drops a code the client sends", async () => {
    const typed = { ...draftOf(), code: "ING-0101" } as CreateClassGroupDTO;
    const group = await create().run({ actorId: ACTOR, classGroup: typed, publish: false });
    expect(group.code).toBe("A-00001");
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
    const group = await groups.create(ClassGroup.create(draftOf(DATES), CODE));
    const advance = new AdvanceClassGroupStatusUseCase(groups, auditLog);

    for (const to of ["enrolling", "in_progress", "finished", "closed"] as const) {
      expect((await advance.run({ actorId: ACTOR, id: group.id, to })).status).toBe(to);
    }
    expect(auditLog.appended.at(-1)).toEqual(
      expect.objectContaining({ action: "catalog.class_group.status_changed", metadata: { from: "finished", to: "closed" } }),
    );
  });

  it("refuses skipping a step or going back", async () => {
    const group = await groups.create(ClassGroup.create(draftOf(DATES), CODE));
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
    const group = await groups.create(ClassGroup.create(draftOf(DATES), CODE));
    groups.seatsTakenOverride.set(group.id, 12);

    await expect(
      new UpdateClassGroupUseCase(courses, groups, teachers, auditLog).run({ actorId: ACTOR, id: group.id, patch: { capacity: 10 } }),
    ).rejects.toBeInstanceOf(CapacityBelowSeatsTakenError);
  });

  it("changes the course only on a draft", async () => {
    const other = await courses.create(Course.create({
        name: "Inglés Kids", language: "Inglés", level: "Kids", summary: "x", minAge: 7, modules: 4, moduleMaterials: Array(4).fill("https://drive.google.com/x"),
        totalHours: 80, certificateRule: "automatic", allowsFreeze: true, allowsTransfer: false,
      }));
    const group = await groups.create(ClassGroup.create(draftOf(DATES), CODE));
    const update = new UpdateClassGroupUseCase(courses, groups, teachers, auditLog);

    await update.run({ actorId: ACTOR, id: group.id, patch: { courseId: other.id } });
    expect(groups.rows.get(group.id)?.courseId).toBe(other.id);

    await new AdvanceClassGroupStatusUseCase(groups, auditLog).run({ actorId: ACTOR, id: group.id, to: "enrolling" });
    await expect(update.run({ actorId: ACTOR, id: group.id, patch: { courseId: course.id } })).rejects.toBeInstanceOf(
      ClassGroupCourseLockedError,
    );
  });

  it("refuses clearing the dates of a published class group", async () => {
    const group = await groups.create(ClassGroup.create(draftOf(DATES), CODE));
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

  it("matches the language whatever its accents", async () => {
    const ana = await teachers.create(teacherOf({ languages: ["INGLES"] }));
    const group = await create().run({ actorId: ACTOR, classGroup: draftOf({ teacherId: ana.id }), publish: false });
    expect(group.teacherId).toBe(ana.id);
  });

  it("allocates on edit, clears the typed name, and audits the field", async () => {
    const ana = await teachers.create(teacherOf());
    const legacy = new ClassGroup({ ...ClassGroup.create(draftOf(), CODE), legacyTeacherName: "Ana T." });
    await groups.create(legacy);

    await update().run({ actorId: ACTOR, id: legacy.id, patch: { teacherId: ana.id } });

    const saved = groups.rows.get(legacy.id)!;
    expect(saved.teacherId).toBe(ana.id);
    expect(saved.legacyTeacherName).toBe("");
    expect(auditLog.appended.at(-1)?.metadata).toEqual({ fields: ["teacherId"], teacherId: ana.id });
  });

  it("takes the allocation away with null", async () => {
    const ana = await teachers.create(teacherOf());
    const group = await groups.create(ClassGroup.create(draftOf({ teacherId: ana.id }), CODE));

    await update().run({ actorId: ACTOR, id: group.id, patch: { teacherId: null } });
    expect(groups.rows.get(group.id)?.teacherId).toBeNull();
  });

  it("never re-checks an untouched allocation — a teacher who left mid-cycle keeps the class group editable", async () => {
    const ana = await teachers.create(teacherOf());
    const group = await groups.create(ClassGroup.create(draftOf({ teacherId: ana.id }), CODE));
    const left = (await teachers.findById(ana.id))!;
    left.leaveRoster();
    await teachers.update(left);

    await update().run({ actorId: ACTOR, id: group.id, patch: { capacity: 25 } });
    expect(groups.rows.get(group.id)?.capacity).toBe(25);
  });

  it("re-checks the allocated teacher against a new course", async () => {
    const italian = await courses.create(
      Course.create({
        name: "Italiano Básico", language: "Italiano", level: "A1", summary: "x", minAge: 13, modules: 4, moduleMaterials: Array(4).fill("https://drive.google.com/x"),
        totalHours: 80, certificateRule: "automatic", allowsFreeze: true, allowsTransfer: false,
      }),
    );
    const ana = await teachers.create(teacherOf());
    const group = await groups.create(ClassGroup.create(draftOf({ teacherId: ana.id }), CODE));

    await expect(
      update().run({ actorId: ACTOR, id: group.id, patch: { courseId: italian.id } }),
    ).rejects.toBeInstanceOf(ClassGroupTeacherLanguageError);
  });
});

describe("The class group's Classroom link (OOC-98)", () => {
  const LINK = "https://classroom.google.com/c/abc";
  const update = () => new UpdateClassGroupUseCase(courses, groups, teachers, auditLog);

  it("stores the link normalized", () => {
    const group = ClassGroup.create(draftOf({ classroomUrl: "  https://CLASSROOM.google.com/c/abc " }), CODE);
    expect(group.classroomUrl).toBe(LINK);
  });

  it("treats a blank link as none", () => {
    expect(ClassGroup.create(draftOf({ classroomUrl: "   " }), CODE).classroomUrl).toBeNull();
    expect(ClassGroup.create(draftOf(), CODE).classroomUrl).toBeNull();
  });

  it.each([
    "http://classroom.google.com/c/abc",
    "https://classroom.google.com.evil.io/c/abc",
    "https://meet.google.com/abc-defg-hij",
    "javascript:alert(1)",
    "not a link",
  ])("refuses %s", (bad) => {
    expect(() => ClassGroup.create(draftOf({ classroomUrl: bad }), CODE)).toThrow(ClassroomUrlInvalidError);
  });

  it("reports the change, and null clears it", () => {
    const group = ClassGroup.create(draftOf(), CODE);
    expect(group.update({ classroomUrl: LINK })).toEqual(["classroomUrl"]);
    expect(group.update({ classroomUrl: ` ${LINK} ` })).toEqual([]);
    expect(group.update({ classroomUrl: null })).toEqual(["classroomUrl"]);
    expect(group.classroomUrl).toBeNull();
  });

  it("leaves the link alone when the patch does not carry it", () => {
    const group = ClassGroup.create(draftOf({ classroomUrl: LINK }), CODE);
    group.update({ capacity: 31 });
    expect(group.classroomUrl).toBe(LINK);
  });

  it("reads back a stored link it would refuse today", () => {
    const group = ClassGroup.create(draftOf(), CODE);
    const stored = new ClassGroup({ ...group, classroomUrl: "https://example.com/x" });
    expect(stored.classroomUrl).toBe("https://example.com/x");
  });

  it("does not carry the link into a duplicated period", () => {
    const group = ClassGroup.create(draftOf({ classroomUrl: LINK }), CODE);
    expect(ClassGroup.copyInto(group, period.id, "A-00002").classroomUrl).toBeNull();
  });

  it("never rewrites the code", () => {
    const group = ClassGroup.create(draftOf(), CODE);
    expect(group.update({ code: "ING-0102" } as UpdateClassGroupDTO)).toEqual([]);
    expect(group.code).toBe(CODE);
  });

  it("audits the field name, never the link", async () => {
    const group = await groups.create(ClassGroup.create(draftOf(), CODE));
    await update().run({ actorId: ACTOR, id: group.id, patch: { classroomUrl: LINK } });
    const entry = auditLog.appended.at(-1)!;
    expect(entry.metadata).toMatchObject({ fields: ["classroomUrl"] });
    expect(JSON.stringify(entry)).not.toContain("classroom.google.com");
  });
});

describe("classGroupCodeOf", () => {
  it.each([
    [1, "A-00001"],
    [42, "A-00042"],
    [99999, "A-99999"],
    [123456, "A-123456"],
  ])("formats %i as %s, never cutting a digit", (n, code) => {
    expect(classGroupCodeOf(n)).toBe(code);
  });
});

describe("The module a class group teaches (OOC-100)", () => {
  const create = () => new CreateClassGroupUseCase(courses, periods, groups, teachers, auditLog);
  const update = () => new UpdateClassGroupUseCase(courses, groups, teachers, auditLog);

  it("stores one of the course's modules", async () => {
    const group = await create().run({ actorId: ACTOR, classGroup: draftOf({ module: 3 }), publish: false });
    expect(group.module).toBe(3);
  });

  it("is born without a module when none is given", async () => {
    const group = await create().run({ actorId: ACTOR, classGroup: draftOf(), publish: false });
    expect(group.module).toBeNull();
  });

  it("refuses a module past the course's count", async () => {
    await expect(
      create().run({ actorId: ACTOR, classGroup: draftOf({ module: 5 }), publish: false }),
    ).rejects.toBeInstanceOf(ClassGroupModuleOutOfRangeError);
  });

  it.each([0, -1, 1.5])("refuses module %s", async (bad) => {
    await expect(
      create().run({ actorId: ACTOR, classGroup: draftOf({ module: bad }), publish: false }),
    ).rejects.toThrow();
  });

  it("checks a new module on edit, and audits the field name", async () => {
    const group = await create().run({ actorId: ACTOR, classGroup: draftOf({ module: 1 }), publish: false });
    await expect(update().run({ actorId: ACTOR, id: group.id, patch: { module: 9 } })).rejects.toBeInstanceOf(
      ClassGroupModuleOutOfRangeError,
    );

    const saved = await update().run({ actorId: ACTOR, id: group.id, patch: { module: 4 } });
    expect(saved.module).toBe(4);
    expect(auditLog.appended.at(-1)!.metadata).toMatchObject({ fields: ["module"] });
  });

  it("null clears it", async () => {
    const group = await create().run({ actorId: ACTOR, classGroup: draftOf({ module: 2 }), publish: false });
    const saved = await update().run({ actorId: ACTOR, id: group.id, patch: { module: null } });
    expect(saved.module).toBeNull();
  });

  it("checks the module against the new course when the course changes", async () => {
    const short = await courses.create(
      Course.create({
        name: "Inglés Express", language: "Inglés", level: "A1", summary: "x", minAge: 13, modules: 2,
        moduleMaterials: Array(2).fill("https://drive.google.com/x"),
        totalHours: 40, certificateRule: "automatic", allowsFreeze: true, allowsTransfer: false,
      }),
    );
    const group = await create().run({ actorId: ACTOR, classGroup: draftOf({ module: 3 }), publish: false });
    await expect(
      update().run({ actorId: ACTOR, id: group.id, patch: { courseId: short.id } }),
    ).rejects.toBeInstanceOf(ClassGroupModuleOutOfRangeError);
  });

  it("does not re-check an untouched module", async () => {
    const group = await create().run({ actorId: ACTOR, classGroup: draftOf({ module: 4 }), publish: false });
    course.update({ modules: 2, moduleMaterials: Array(2).fill("https://drive.google.com/x") });
    const saved = await update().run({ actorId: ACTOR, id: group.id, patch: { capacity: 25 } });
    expect(saved.module).toBe(4);
  });
});

describe("materialOfModule (OOC-100)", () => {
  const MATERIALS = ["https://drive.google.com/m1", "https://drive.google.com/m2"];

  it("picks the module's link, 1-based", () => {
    expect(materialOfModule(MATERIALS, 2)).toBe("https://drive.google.com/m2");
  });

  it("has nothing to open without a module, without materials or past the list", () => {
    expect(materialOfModule(MATERIALS, null)).toBeNull();
    expect(materialOfModule([], 1)).toBeNull();
    expect(materialOfModule(MATERIALS, 3)).toBeNull();
  });
});
