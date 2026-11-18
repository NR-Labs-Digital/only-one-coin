import {
  AcademicPeriod,
  AdvanceClassGroupStatusUseCase,
  CapacityBelowSeatsTakenError,
  ClassGroup,
  ClassGroupCourseLockedError,
  ClassGroupIncompleteError,
  ClassroomUrlInvalidError,
  MeetUrlInvalidError,
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
  UpdateClassGroupModuleUseCase,
  AddClassGroupModuleUseCase,
  RetireClassGroupModuleUseCase,
  ClassGroupModuleTakenError,
  ClassGroupModuleAloneError,
  ClassGroupFullCourseSplitError,
  ClassGroupLastModuleError,
  ClassGroupModuleHasStudentsError,
  ClassGroupModule,
  classGroupCodeOf,
  classroomLinksOf,
  isMissingClassroom,
  materialOfModule,
  type CreateClassGroupDTO,
  type CreateTeacherDTO,
  type UpdateClassGroupDTO,
  type UpdateClassGroupModuleDTO,
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

/** The class group's first module run (OOC-156) — where the form's teaching fields land. */
function entry(group: ClassGroup | undefined): ClassGroupModule {
  return group!.entryModule!;
}

/** Edits the first run and answers the class group as the repository holds it after. */
async function editRunOf(group: ClassGroup, patch: UpdateClassGroupModuleDTO): Promise<ClassGroup> {
  await editRun(group, patch);
  return groups.rows.get(group.id)!;
}

/** Edits the class group's first run, the way the form used to edit the class group. */
function editRun(group: ClassGroup, patch: UpdateClassGroupModuleDTO): Promise<ClassGroupModule> {
  return new UpdateClassGroupModuleUseCase(courses, groups, teachers, auditLog).run({
    actorId: ACTOR,
    classGroupId: group.id,
    classGroupModuleId: entry(group).id,
    patch,
  });
}

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

    expect(entry(groups.rows.get(group.id)).teacherId).toBe(ana.id);
    expect(auditLog.appended.at(-1)?.metadata).toEqual(expect.objectContaining({ teacherId: ana.id }));
  });

  it("opens a class group with nobody allocated yet", async () => {
    const group = await create().run({ actorId: ACTOR, classGroup: draftOf(), publish: false });
    expect(entry(group).teacherId).toBeNull();
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
    expect(entry(group).teacherId).toBe(ana.id);
  });

  it("matches the language whatever its accents", async () => {
    const ana = await teachers.create(teacherOf({ languages: ["INGLES"] }));
    const group = await create().run({ actorId: ACTOR, classGroup: draftOf({ teacherId: ana.id }), publish: false });
    expect(entry(group).teacherId).toBe(ana.id);
  });

  it("allocates on edit, clears the typed name, and audits the field", async () => {
    const ana = await teachers.create(teacherOf());
    const legacy = await groups.create(ClassGroup.create(draftOf(), CODE));
    entry(legacy).legacyTeacherName = "Ana T.";

    await editRun(legacy, { teacherId: ana.id });

    const saved = entry(groups.rows.get(legacy.id));
    expect(saved.teacherId).toBe(ana.id);
    expect(saved.legacyTeacherName).toBe("");
    expect(auditLog.appended.at(-1)).toMatchObject({
      action: "catalog.class_group.module_updated",
      targetId: legacy.id,
      metadata: { classGroupModuleId: saved.id, fields: ["teacherId"], teacherId: ana.id },
    });
  });

  it("takes the allocation away with null", async () => {
    const ana = await teachers.create(teacherOf());
    const group = await groups.create(ClassGroup.create(draftOf({ teacherId: ana.id }), CODE));

    await editRun(group, { teacherId: null });
    expect(entry(groups.rows.get(group.id)).teacherId).toBeNull();
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

describe("The class group's Classroom links, one per module (OOC-144)", () => {
  const LINK = "https://classroom.google.com/c/abc";
  const LINK2 = "https://classroom.google.com/c/def";
  const create = () => new CreateClassGroupUseCase(courses, periods, groups, teachers, auditLog);

  it("stores each link normalized, keyed by its module", () => {
    const group = ClassGroup.create(
      draftOf({ module: 2, classroomLinks: [{ module: 2, url: "  https://CLASSROOM.google.com/c/abc " }] }),
      CODE,
    );
    expect(entry(group).classroomLinks).toEqual({ "2": LINK });
    expect(entry(group).classroomUrl).toBeNull();
  });

  it("treats a blank link as none", () => {
    expect(entry(ClassGroup.create(draftOf({ classroomLinks: [{ module: 1, url: "   " }] }), CODE)).classroomLinks).toEqual({});
    expect(entry(ClassGroup.create(draftOf(), CODE)).classroomLinks).toEqual({});
  });

  it.each([
    "http://classroom.google.com/c/abc",
    "https://classroom.google.com.evil.io/c/abc",
    "https://meet.google.com/abc-defg-hij",
    "javascript:alert(1)",
    "not a link",
  ])("refuses %s", (bad) => {
    expect(() => ClassGroup.create(draftOf({ classroomLinks: [{ module: 1, url: bad }] }), CODE)).toThrow(
      ClassroomUrlInvalidError,
    );
  });

  it("reports the change once, touches only the modules named, and null clears one", () => {
    const run = entry(ClassGroup.create(draftOf({ fullCourse: true, classroomLinks: [{ module: 1, url: LINK }] }), CODE));
    expect(run.update({ classroomLinks: [{ module: 2, url: LINK2 }] })).toEqual(["classroomLinks"]);
    expect(run.classroomLinks).toEqual({ "1": LINK, "2": LINK2 });
    expect(run.update({ classroomLinks: [{ module: 2, url: ` ${LINK2} ` }] })).toEqual([]);
    expect(run.update({ classroomLinks: [{ module: 1, url: null }] })).toEqual(["classroomLinks"]);
    expect(run.classroomLinks).toEqual({ "2": LINK2 });
  });

  it("leaves the links alone when the patch does not carry them", () => {
    const group = ClassGroup.create(draftOf({ module: 1, classroomLinks: [{ module: 1, url: LINK }] }), CODE);
    group.update({ capacity: 31 });
    expect(entry(group).classroomLinks).toEqual({ "1": LINK });
  });

  it("keeps a module's link when the class group moves to the next module", () => {
    const group = ClassGroup.create(draftOf({ module: 1, classroomLinks: [{ module: 1, url: LINK }] }), CODE);
    entry(group).update({ module: 2, classroomLinks: [{ module: 2, url: LINK2 }] });
    expect(entry(group).classroomLinks).toEqual({ "1": LINK, "2": LINK2 });
    expect(classroomLinksOf(entry(group), 4)).toEqual([{ module: 2, url: LINK2 }]);
  });

  it("does not carry the links into a duplicated period", () => {
    const group = ClassGroup.create(draftOf({ module: 1, classroomLinks: [{ module: 1, url: LINK }] }), CODE);
    const copy = ClassGroup.copyInto(group, period.id, "A-00002");
    expect(entry(copy).classroomLinks).toEqual({});
    expect(entry(copy).module).toBe(1);
    expect(entry(copy).classGroupId).toBe(copy.id);
  });

  it("refuses a link for a module the course does not have, and still lets one be cleared", async () => {
    await expect(
      create().run({ actorId: ACTOR, classGroup: draftOf({ classroomLinks: [{ module: 5, url: LINK }] }), publish: false }),
    ).rejects.toBeInstanceOf(ClassGroupModuleOutOfRangeError);

    const group = await groups.create(ClassGroup.create(draftOf(), CODE));
    await expect(editRun(group, { classroomLinks: [{ module: 5, url: LINK }] })).rejects.toBeInstanceOf(
      ClassGroupModuleOutOfRangeError,
    );
    await expect(editRun(group, { classroomLinks: [{ module: 5, url: null }] })).resolves.toBeDefined();
  });

  it("never rewrites the code", () => {
    const group = ClassGroup.create(draftOf(), CODE);
    expect(group.update({ code: "ING-0102" } as UpdateClassGroupDTO)).toEqual([]);
    expect(group.code).toBe(CODE);
  });

  it("audits the field name, never the link", async () => {
    const group = await groups.create(ClassGroup.create(draftOf({ module: 1 }), CODE));
    await editRun(group, { classroomLinks: [{ module: 1, url: LINK }] });
    const logged = auditLog.appended.at(-1)!;
    expect(logged.metadata).toMatchObject({ fields: ["classroomLinks"] });
    expect(JSON.stringify(logged)).not.toContain("classroom.google.com");
  });
});

describe("classroomLinksOf / isMissingClassroom (OOC-144)", () => {
  const LINK = "https://classroom.google.com/c/abc";
  const base = { module: null, fullCourse: false, classroomLinks: {}, classroomUrl: null };

  it("answers the link of the one module the class group teaches, not the others it kept", () => {
    const group = { ...base, module: 2, classroomLinks: { "1": "https://classroom.google.com/c/old", "2": LINK } };
    expect(classroomLinksOf(group, 4)).toEqual([{ module: 2, url: LINK }]);
    expect(isMissingClassroom(group, 4)).toBe(false);
  });

  it("answers every module's link on a full course, in order, and warns while one is missing", () => {
    const group = { ...base, fullCourse: true, classroomLinks: { "3": LINK, "1": LINK } };
    expect(classroomLinksOf(group, 3)).toEqual([
      { module: 1, url: LINK },
      { module: 3, url: LINK },
    ]);
    expect(isMissingClassroom(group, 3)).toBe(true);
    expect(isMissingClassroom({ ...group, classroomLinks: { "1": LINK, "2": LINK, "3": LINK } }, 3)).toBe(false);
  });

  it("falls back to the link pasted before OOC-144 while no module is set", () => {
    expect(classroomLinksOf({ ...base, classroomUrl: LINK }, 4)).toEqual([{ module: null, url: LINK }]);
    expect(isMissingClassroom({ ...base, classroomUrl: LINK }, 4)).toBe(false);
    expect(classroomLinksOf(base, 4)).toEqual([]);
    expect(isMissingClassroom(base, 4)).toBe(true);
  });

  it("ignores the old single link once a module is set", () => {
    const group = { ...base, module: 1, classroomUrl: LINK };
    expect(classroomLinksOf(group, 4)).toEqual([]);
    expect(isMissingClassroom(group, 4)).toBe(true);
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
    expect(entry(group).module).toBe(3);
  });

  it("is born without a module when none is given", async () => {
    const group = await create().run({ actorId: ACTOR, classGroup: draftOf(), publish: false });
    expect(entry(group).module).toBeNull();
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
    await expect(editRun(group, { module: 9 })).rejects.toBeInstanceOf(
      ClassGroupModuleOutOfRangeError,
    );

    const saved = await editRunOf(group, { module: 4 });
    expect(entry(saved).module).toBe(4);
    expect(auditLog.appended.at(-1)!.metadata).toMatchObject({ fields: ["module"] });
  });

  it("null clears it", async () => {
    const group = await create().run({ actorId: ACTOR, classGroup: draftOf({ module: 2 }), publish: false });
    const saved = await editRunOf(group, { module: null });
    expect(entry(saved).module).toBeNull();
  });

  it("opens one run per module for a full course, same teacher and week, each its own Classroom (OOC-156)", async () => {
    const ana = await teachers.create(teacherOf());
    const LINK3 = "https://classroom.google.com/c/m3";
    const group = await create().run({
      actorId: ACTOR,
      classGroup: draftOf({ fullCourse: true, teacherId: ana.id, classroomLinks: [{ module: 3, url: LINK3 }] }),
      publish: false,
    });
    expect(group.modules.map((run) => run.module)).toEqual([1, 2, 3, 4]);
    expect(group.modules.every((run) => !run.fullCourse && run.teacherId === ana.id)).toBe(true);
    expect(group.modules.every((run) => JSON.stringify(run.slots) === JSON.stringify(draftOf().slots))).toBe(true);
    expect(group.modules.map((run) => run.classroomLinks)).toEqual([{}, {}, { "3": LINK3 }, {}]);
    expect(entry(group).module).toBe(1);
  });

  it("lets the full course win over a module sent with it, without range-checking that module", async () => {
    const group = await create().run({
      actorId: ACTOR,
      classGroup: draftOf({ fullCourse: true, module: 9 }),
      publish: false,
    });
    expect(group.modules.map((run) => run.module)).toEqual([1, 2, 3, 4]);
  });

  it("is born without the full course when not asked for", async () => {
    const group = await create().run({ actorId: ACTOR, classGroup: draftOf({ module: 2 }), publish: false });
    expect(entry(group).fullCourse).toBe(false);
    expect(group.modules).toHaveLength(1);
  });

  it("never turns a run into the full course: a full course is one run per module (OOC-156)", async () => {
    const group = await create().run({ actorId: ACTOR, classGroup: draftOf({ module: 2 }), publish: false });
    await expect(editRun(group, { fullCourse: true, module: null })).rejects.toBeInstanceOf(
      ClassGroupFullCourseSplitError,
    );
    expect(entry(groups.rows.get(group.id)).module).toBe(2);
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
    expect(entry(saved).module).toBe(4);
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

describe("Module runs of a class group (OOC-156)", () => {
  const SLOTS_B = [{ weekday: "tue" as const, startTime: "19:00", endTime: "20:30" }];
  const add = () => new AddClassGroupModuleUseCase(courses, groups, teachers, auditLog);
  const retire = () => new RetireClassGroupModuleUseCase(groups, auditLog);

  it("opens the class group with its first run, holding the form's teaching fields", async () => {
    const ana = await teachers.create(teacherOf());
    const group = await new CreateClassGroupUseCase(courses, periods, groups, teachers, auditLog).run({
      actorId: ACTOR,
      classGroup: draftOf({ module: 1, teacherId: ana.id }),
      publish: false,
    });
    expect(group.modules).toHaveLength(1);
    expect(entry(group)).toMatchObject({ classGroupId: group.id, module: 1, teacherId: ana.id });
    expect(entry(group).slots).toEqual(draftOf().slots);
  });

  it("runs another module beside the first, with its own schedule and teacher, and audits it", async () => {
    const ana = await teachers.create(teacherOf());
    const group = await groups.create(ClassGroup.create(draftOf({ module: 1 }), CODE));

    const second = await add().run({
      actorId: ACTOR,
      classGroupId: group.id,
      module: { module: 2, slots: SLOTS_B, teacherId: ana.id },
    });

    const saved = groups.rows.get(group.id)!;
    expect(saved.modules.map((run) => run.module)).toEqual([1, 2]);
    expect(second).toMatchObject({ module: 2, teacherId: ana.id, slots: SLOTS_B });
    expect(entry(saved).module).toBe(1);
    expect(auditLog.appended.at(-1)).toMatchObject({
      action: "catalog.class_group.module_added",
      targetId: group.id,
      metadata: { classGroupModuleId: second.id, module: 2, fullCourse: false, teacherId: ana.id },
    });
  });

  it("puts a new student in the lowest run — module 1 once it exists", () => {
    const group = ClassGroup.create(draftOf({ module: 3 }), CODE);
    expect(entry(group).module).toBe(3);
    group.addModule({ module: 1, slots: SLOTS_B });
    expect(entry(group).module).toBe(1);
  });

  it("refuses a second run of the same module", async () => {
    const group = await groups.create(ClassGroup.create(draftOf({ module: 1 }), CODE));
    await expect(
      add().run({ actorId: ACTOR, classGroupId: group.id, module: { module: 1, slots: SLOTS_B } }),
    ).rejects.toBeInstanceOf(ClassGroupModuleTakenError);
    expect(groups.rows.get(group.id)!.modules).toHaveLength(1);
  });

  it("refuses moving a run onto a module another run already teaches", async () => {
    const group = await groups.create(ClassGroup.create(draftOf({ module: 1 }), CODE));
    const second = await add().run({ actorId: ACTOR, classGroupId: group.id, module: { module: 2, slots: SLOTS_B } });
    await expect(
      new UpdateClassGroupModuleUseCase(courses, groups, teachers, auditLog).run({
        actorId: ACTOR,
        classGroupId: group.id,
        classGroupModuleId: second.id,
        patch: { module: 1 },
      }),
    ).rejects.toBeInstanceOf(ClassGroupModuleTakenError);
  });

  it("keeps a run with no module set alone in its class group", async () => {
    const group = await groups.create(ClassGroup.create(draftOf(), CODE));
    await expect(
      add().run({ actorId: ACTOR, classGroupId: group.id, module: { module: 2, slots: SLOTS_B } }),
    ).rejects.toBeInstanceOf(ClassGroupModuleAloneError);

    const numbered = await groups.create(ClassGroup.create(draftOf({ module: 1 }), "A-00002"));
    await expect(
      add().run({ actorId: ACTOR, classGroupId: numbered.id, module: { slots: SLOTS_B } }),
    ).rejects.toBeInstanceOf(ClassGroupModuleAloneError);
  });

  it("never opens a full-course run beside the others", async () => {
    const numbered = await groups.create(ClassGroup.create(draftOf({ module: 1 }), CODE));
    await expect(
      add().run({ actorId: ACTOR, classGroupId: numbered.id, module: { fullCourse: true, slots: SLOTS_B } }),
    ).rejects.toBeInstanceOf(ClassGroupFullCourseSplitError);
  });

  it("checks the new run's module and teacher like the first one's", async () => {
    const group = await groups.create(ClassGroup.create(draftOf({ module: 1 }), CODE));
    const luis = await teachers.create(teacherOf({ nationalId: "87654321", languages: ["Italiano"] }));
    await expect(
      add().run({ actorId: ACTOR, classGroupId: group.id, module: { module: 5, slots: SLOTS_B } }),
    ).rejects.toBeInstanceOf(ClassGroupModuleOutOfRangeError);
    await expect(
      add().run({ actorId: ACTOR, classGroupId: group.id, module: { module: 2, slots: SLOTS_B, teacherId: luis.id } }),
    ).rejects.toBeInstanceOf(ClassGroupTeacherLanguageError);
  });

  it("re-checks every run's teacher against a new course", async () => {
    const italian = await courses.create(
      Course.create({
        name: "Italiano Básico", language: "Italiano", level: "A1", summary: "x", minAge: 13, modules: 4,
        moduleMaterials: Array(4).fill("https://drive.google.com/x"),
        totalHours: 80, certificateRule: "automatic", allowsFreeze: true, allowsTransfer: false,
      }),
    );
    const ana = await teachers.create(teacherOf());
    const group = await groups.create(ClassGroup.create(draftOf({ module: 1 }), CODE));
    await add().run({ actorId: ACTOR, classGroupId: group.id, module: { module: 2, slots: SLOTS_B, teacherId: ana.id } });

    await expect(
      new UpdateClassGroupUseCase(courses, groups, teachers, auditLog).run({
        actorId: ACTOR,
        id: group.id,
        patch: { courseId: italian.id },
      }),
    ).rejects.toBeInstanceOf(ClassGroupTeacherLanguageError);
  });

  it("retires a run, never the last one, and audits it", async () => {
    const group = await groups.create(ClassGroup.create(draftOf({ module: 1 }), CODE));
    const second = await add().run({ actorId: ACTOR, classGroupId: group.id, module: { module: 2, slots: SLOTS_B } });

    await retire().run({ actorId: ACTOR, classGroupId: group.id, classGroupModuleId: second.id });
    expect(groups.rows.get(group.id)!.modules.map((run) => run.module)).toEqual([1]);
    expect(auditLog.appended.at(-1)).toMatchObject({
      action: "catalog.class_group.module_retired",
      metadata: { classGroupModuleId: second.id, module: 2 },
    });

    await expect(
      retire().run({ actorId: ACTOR, classGroupId: group.id, classGroupModuleId: entry(group).id }),
    ).rejects.toBeInstanceOf(ClassGroupLastModuleError);
  });

  it("keeps a run students are still in", async () => {
    const group = await groups.create(ClassGroup.create(draftOf({ module: 1 }), CODE));
    const second = await add().run({ actorId: ACTOR, classGroupId: group.id, module: { module: 2, slots: SLOTS_B } });
    groups.occupiedModules.add(second.id);
    await expect(
      retire().run({ actorId: ACTOR, classGroupId: group.id, classGroupModuleId: second.id }),
    ).rejects.toBeInstanceOf(ClassGroupModuleHasStudentsError);
  });

  it("copies every run into a duplicated period, without the Classroom", () => {
    const group = ClassGroup.create(
      draftOf({ module: 1, classroomLinks: [{ module: 1, url: "https://classroom.google.com/c/abc" }] }),
      CODE,
    );
    group.addModule({ module: 2, slots: SLOTS_B });
    const copy = ClassGroup.copyInto(group, period.id, "A-00002");
    expect(copy.modules.map((run) => [run.module, run.classGroupId, run.classroomLinks])).toEqual([
      [1, copy.id, {}],
      [2, copy.id, {}],
    ]);
    expect(copy.modules.every((run) => !group.modules.some((source) => source.id === run.id))).toBe(true);
  });
});

describe("The module group's Meet link (OOC-159)", () => {
  const MEET = "https://meet.google.com/abc-defg-hij";

  it("keeps an https link on meet.google.com, normalized, and a blank one as none", () => {
    expect(entry(ClassGroup.create(draftOf({ module: 1, meetUrl: "  https://MEET.google.com/abc-defg-hij " }), CODE)).meetUrl).toBe(
      MEET,
    );
    expect(entry(ClassGroup.create(draftOf({ meetUrl: "   " }), CODE)).meetUrl).toBeNull();
    expect(entry(ClassGroup.create(draftOf(), CODE)).meetUrl).toBeNull();
  });

  it.each([
    "http://meet.google.com/abc-defg-hij",
    "https://meet.google.com.evil.io/abc",
    "https://classroom.google.com/c/abc",
    "javascript:alert(1)",
    "not a link",
  ])("refuses %s", (bad) => {
    expect(() => ClassGroup.create(draftOf({ meetUrl: bad }), CODE)).toThrow(MeetUrlInvalidError);
  });

  it("gives none to the module groups a full course opens — each gets its own", () => {
    const group = ClassGroup.create(draftOf({ fullCourse: true, meetUrl: MEET }), CODE, 3);
    expect(group.modules).toHaveLength(3);
    expect(group.modules.every((run) => run.meetUrl === null)).toBe(true);
  });

  it("is edited on the module group, audited by name only, and cleared with null", async () => {
    const group = await groups.create(ClassGroup.create(draftOf({ module: 1 }), CODE));

    const saved = await editRunOf(group, { meetUrl: MEET });
    expect(entry(saved).meetUrl).toBe(MEET);
    expect(auditLog.appended.at(-1)!.metadata).toMatchObject({ fields: ["meetUrl"] });
    expect(JSON.stringify(auditLog.appended.at(-1)!.metadata)).not.toContain("meet.google.com");

    expect(entry(group).update({ meetUrl: ` ${MEET} ` })).toEqual([]);
    expect(entry(await editRunOf(saved, { meetUrl: null })).meetUrl).toBeNull();
  });

  it("does not carry the link into a duplicated period", () => {
    const group = ClassGroup.create(draftOf({ module: 1, meetUrl: MEET }), CODE);
    expect(entry(ClassGroup.copyInto(group, period.id, "A-00002")).meetUrl).toBeNull();
  });
});
