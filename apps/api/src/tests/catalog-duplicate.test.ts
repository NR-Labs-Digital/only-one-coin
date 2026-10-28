import {
  AcademicPeriod,
  ClassGroup,
  DuplicateClassGroupsUseCase,
  DuplicateSamePeriodError,
  PeriodAlreadyDuplicatedError,
  PeriodNotFoundError,
} from "@ooc/domain";
import { randomUUID as uuid } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { FakeAcademicPeriodRepository, FakeAuditLogRepository, FakeClassGroupRepository } from "./fakes/catalog.js";

/**
 * Period duplication (OOC-35 acceptance criterion): the class groups of one
 * period come over as drafts with no dates, no window and no seats taken —
 * retired ones stay behind, and it runs once per (source, target).
 */

const ACTOR = "usr_coord";
const COURSE_ID = uuid();
const TEACHER_ID = uuid();
const SLOTS = [{ weekday: "mon" as const, startTime: "18:00", endTime: "19:30" }];

let periods: FakeAcademicPeriodRepository;
let groups: FakeClassGroupRepository;
let auditLog: FakeAuditLogRepository;
let source: AcademicPeriod;
let target: AcademicPeriod;
let running: ClassGroup;
let draft: ClassGroup;

const duplicate = () => new DuplicateClassGroupsUseCase(periods, groups, auditLog);

beforeEach(async () => {
  periods = new FakeAcademicPeriodRepository();
  groups = new FakeClassGroupRepository();
  auditLog = new FakeAuditLogRepository();

  source = await periods.create(
    AcademicPeriod.create({
      name: "Ciclo 2026-III",
      startsOn: new Date("2026-08-03T05:00:00Z"),
      endsOn: new Date("2026-10-31T05:00:00Z"),
    }),
  );
  target = await periods.create(
    AcademicPeriod.create({
      name: "Ciclo 2026-IV",
      startsOn: new Date("2026-11-02T05:00:00Z"),
      endsOn: new Date("2027-01-30T05:00:00Z"),
    }),
  );

  // Already running, with seats taken by enrolled students.
  running = await groups.create(
    new ClassGroup({
      id: uuid(),
      courseId: COURSE_ID,
      academicPeriodId: source.id,
      code: "ING-0101",
      teacherId: TEACHER_ID,
      legacyTeacherName: "",
      classroomUrl: "https://classroom.google.com/c/running",
      slots: SLOTS,
      startsOn: new Date("2026-08-03T05:00:00Z"),
      endsOn: new Date("2026-10-31T05:00:00Z"),
      enrollmentOpensAt: new Date("2026-07-20T05:00:00Z"),
      enrollmentClosesAt: new Date("2026-08-10T05:00:00Z"),
      capacity: 25,
      seatsTaken: 20,
      status: "in_progress",
      sourceClassGroupId: null,
    }),
  );
  draft = await groups.create(
    ClassGroup.create({
      courseId: COURSE_ID,
      academicPeriodId: source.id,
      slots: SLOTS,
      capacity: 30,
    }, "A-00102"),
  );
  const retired = ClassGroup.create({
    courseId: COURSE_ID,
    academicPeriodId: source.id,
    slots: SLOTS,
    capacity: 20,
  }, "A-00103");
  retired.softDelete();
  await groups.create(retired);
});

describe("DuplicateClassGroupsUseCase", () => {
  it("copies the live class groups as empty drafts and leaves the retired one behind", async () => {
    const result = await duplicate().run({ actorId: ACTOR, sourcePeriodId: source.id, targetPeriodId: target.id });
    expect(result).toEqual({ copied: 2, skippedRetired: 1 });

    const copies = [...groups.rows.values()].filter((group) => group.academicPeriodId === target.id);
    expect(copies).toHaveLength(2);
    for (const copy of copies) {
      expect(copy.status).toBe("draft");
      expect(copy.startsOn).toBeNull();
      expect(copy.endsOn).toBeNull();
      expect(copy.enrollmentOpensAt).toBeNull();
      expect(copy.enrollmentClosesAt).toBeNull();
      expect(copy.seatsTaken).toBe(0);
      expect(copy.classroomUrl).toBeNull();
      expect(copy.academicPeriodId).toBe(target.id);
    }

    const bySource = new Map(copies.map((copy) => [copy.sourceClassGroupId, copy]));
    expect(bySource.get(running.id)?.capacity).toBe(running.capacity);
    expect(bySource.get(draft.id)?.capacity).toBe(draft.capacity);
    // Same teacher in the new period (CLAUDE.md §1); nobody stays nobody.
    expect(bySource.get(running.id)?.teacherId).toBe(TEACHER_ID);
    expect(bySource.get(draft.id)?.teacherId).toBeNull();
    expect(bySource.size).toBe(2);
  });

  it("gives every copy a code of its own, never the source's", async () => {
    await duplicate().run({ actorId: ACTOR, sourcePeriodId: source.id, targetPeriodId: target.id });

    const codes = [...groups.rows.values()]
      .filter((group) => group.academicPeriodId === target.id)
      .map((group) => group.code)
      .sort();
    expect(codes).toEqual(["A-00001", "A-00002"]);
  });

  it("writes one audit row on the target period", async () => {
    await duplicate().run({ actorId: ACTOR, sourcePeriodId: source.id, targetPeriodId: target.id });

    expect(auditLog.appended).toEqual([
      expect.objectContaining({
        actorId: ACTOR,
        action: "catalog.academic_period.duplicated",
        targetId: target.id,
        metadata: { sourcePeriodId: source.id, copied: 2, skippedRetired: 1 },
      }),
    ]);
  });

  it("refuses a second run into the same target", async () => {
    await duplicate().run({ actorId: ACTOR, sourcePeriodId: source.id, targetPeriodId: target.id });

    await expect(
      duplicate().run({ actorId: ACTOR, sourcePeriodId: source.id, targetPeriodId: target.id }),
    ).rejects.toBeInstanceOf(PeriodAlreadyDuplicatedError);
    expect(auditLog.appended).toHaveLength(1);
  });

  it("refuses copying a period into itself", async () => {
    await expect(
      duplicate().run({ actorId: ACTOR, sourcePeriodId: source.id, targetPeriodId: source.id }),
    ).rejects.toBeInstanceOf(DuplicateSamePeriodError);
  });

  it("refuses a retired target", async () => {
    target.softDelete();
    await expect(
      duplicate().run({ actorId: ACTOR, sourcePeriodId: source.id, targetPeriodId: target.id }),
    ).rejects.toBeInstanceOf(PeriodNotFoundError);
  });

  it("accepts a retired source — copying the cycle that just left is the normal case", async () => {
    source.softDelete();
    const result = await duplicate().run({ actorId: ACTOR, sourcePeriodId: source.id, targetPeriodId: target.id });
    expect(result).toEqual({ copied: 2, skippedRetired: 1 });
  });

  it("refuses an unknown source", async () => {
    await expect(
      duplicate().run({ actorId: ACTOR, sourcePeriodId: uuid(), targetPeriodId: target.id }),
    ).rejects.toBeInstanceOf(PeriodNotFoundError);
  });
});
