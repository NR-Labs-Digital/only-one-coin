import {
  CatalogClassGroupNotFoundError,
  ClassGroup,
  ClassGroupNotFullError,
  JoinWaitlistUseCase,
  LeaveWaitlistUseCase,
  WaitlistAlreadyEnrolledError,
  WaitlistAlreadyJoinedError,
  WaitlistEntryClosedError,
  WaitlistEntryNotFoundError,
  WaitlistStudentNotFoundError,
  type ClassGroupProps,
} from "@ooc/domain";
import { randomUUID as uuid } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { FakeAuditLogRepository, FakeClassGroupRepository, FakeWaitlistRepository } from "./fakes/catalog.js";

/**
 * The manual waitlist (OOC-35): staff queues a student on a full class group,
 * once per class group while still waiting, and takes them out with a reason.
 * Leaving is marked, never deleted.
 */

const ACTOR = "usr_coord";
const STUDENT = uuid();
let groups: FakeClassGroupRepository;
let waitlist: FakeWaitlistRepository;
let auditLog: FakeAuditLogRepository;

function groupOf(overrides: Partial<ClassGroupProps> = {}): ClassGroup {
  return new ClassGroup({
    id: uuid(),
    courseId: uuid(),
    academicPeriodId: uuid(),
    code: "ING-0101",
    teacherId: null,
    legacyTeacherName: "",
    classroomUrl: null,
    module: null,
    slots: [{ weekday: "mon", startTime: "18:00", endTime: "19:30" }],
    startsOn: new Date("2026-11-02T05:00:00Z"),
    endsOn: new Date("2027-01-30T05:00:00Z"),
    enrollmentOpensAt: null,
    enrollmentClosesAt: null,
    capacity: 2,
    seatsTaken: 2,
    status: "enrolling",
    sourceClassGroupId: null,
    ...overrides,
  });
}

beforeEach(() => {
  groups = new FakeClassGroupRepository();
  waitlist = new FakeWaitlistRepository();
  auditLog = new FakeAuditLogRepository();
});

const join = () => new JoinWaitlistUseCase(groups, waitlist, auditLog);
const leave = () => new LeaveWaitlistUseCase(waitlist, auditLog);

describe("JoinWaitlistUseCase", () => {
  it("queues a student on a full class group and audits it", async () => {
    const group = await groups.create(groupOf());
    const entry = await join().run({ actorId: ACTOR, classGroupId: group.id, studentId: STUDENT });

    expect(entry).toMatchObject({ classGroupId: group.id, studentId: STUDENT, leftAt: null, leftReason: null });
    expect(waitlist.rows.get(entry.id)).toBe(entry);
    expect(auditLog.appended).toHaveLength(1);
    expect(auditLog.appended[0]).toMatchObject({
      actorId: ACTOR,
      action: "catalog.waitlist.joined",
      targetId: entry.id,
      metadata: { classGroupId: group.id, studentId: STUDENT },
    });
  });

  it("refuses a class group with seats left", async () => {
    const group = await groups.create(groupOf({ seatsTaken: 1 }));
    await expect(join().run({ actorId: ACTOR, classGroupId: group.id, studentId: STUDENT })).rejects.toBeInstanceOf(
      ClassGroupNotFullError,
    );
    expect(waitlist.rows.size).toBe(0);
    expect(auditLog.appended).toHaveLength(0);
  });

  it("refuses a retired or unknown class group", async () => {
    const retired = await groups.create(groupOf({ deletedAt: new Date() }));
    await expect(join().run({ actorId: ACTOR, classGroupId: retired.id, studentId: STUDENT })).rejects.toBeInstanceOf(
      CatalogClassGroupNotFoundError,
    );
    await expect(join().run({ actorId: ACTOR, classGroupId: uuid(), studentId: STUDENT })).rejects.toBeInstanceOf(
      CatalogClassGroupNotFoundError,
    );
  });

  it("refuses a finished or closed class group: it is no longer on offer", async () => {
    for (const status of ["finished", "closed"] as const) {
      const group = await groups.create(groupOf({ status }));
      await expect(join().run({ actorId: ACTOR, classGroupId: group.id, studentId: STUDENT })).rejects.toBeInstanceOf(
        CatalogClassGroupNotFoundError,
      );
    }
    expect(waitlist.rows.size).toBe(0);
    expect(auditLog.appended).toHaveLength(0);
  });

  it("refuses a student not on file", async () => {
    const group = await groups.create(groupOf());
    waitlist.standing.set(`${STUDENT}:${group.id}`, "missing");
    await expect(join().run({ actorId: ACTOR, classGroupId: group.id, studentId: STUDENT })).rejects.toBeInstanceOf(
      WaitlistStudentNotFoundError,
    );
  });

  it("refuses a student already enrolled in that class group", async () => {
    const group = await groups.create(groupOf());
    waitlist.standing.set(`${STUDENT}:${group.id}`, "enrolled");
    await expect(join().run({ actorId: ACTOR, classGroupId: group.id, studentId: STUDENT })).rejects.toBeInstanceOf(
      WaitlistAlreadyEnrolledError,
    );
  });

  it("refuses a second active place for the same student and class group", async () => {
    const group = await groups.create(groupOf());
    await join().run({ actorId: ACTOR, classGroupId: group.id, studentId: STUDENT });
    await expect(join().run({ actorId: ACTOR, classGroupId: group.id, studentId: STUDENT })).rejects.toBeInstanceOf(
      WaitlistAlreadyJoinedError,
    );
    expect(waitlist.rows.size).toBe(1);
    expect(auditLog.appended).toHaveLength(1);
  });
});

describe("LeaveWaitlistUseCase", () => {
  it("marks the place as left with the staff's reason and audits it", async () => {
    const group = await groups.create(groupOf());
    const entry = await join().run({ actorId: ACTOR, classGroupId: group.id, studentId: STUDENT });

    const left = await leave().run({ actorId: ACTOR, entryId: entry.id, reason: "withdrawn" });

    expect(left.leftAt).toBeInstanceOf(Date);
    expect(left.leftReason).toBe("withdrawn");
    expect(waitlist.rows.get(entry.id)?.leftReason).toBe("withdrawn");
    expect(auditLog.appended.at(-1)).toMatchObject({
      actorId: ACTOR,
      action: "catalog.waitlist.left",
      targetId: entry.id,
      metadata: { classGroupId: group.id, reason: "withdrawn" },
    });
  });

  it("refuses to close a place twice", async () => {
    const group = await groups.create(groupOf());
    const entry = await join().run({ actorId: ACTOR, classGroupId: group.id, studentId: STUDENT });
    await leave().run({ actorId: ACTOR, entryId: entry.id, reason: "withdrawn" });

    await expect(
      leave().run({ actorId: ACTOR, entryId: entry.id, reason: "removed_by_staff" }),
    ).rejects.toBeInstanceOf(WaitlistEntryClosedError);
    expect(auditLog.appended.filter((row) => row.action === "catalog.waitlist.left")).toHaveLength(1);
  });

  it("refuses an unknown place", async () => {
    await expect(leave().run({ actorId: ACTOR, entryId: uuid(), reason: "withdrawn" })).rejects.toBeInstanceOf(
      WaitlistEntryNotFoundError,
    );
  });

  it("a student who left can queue again", async () => {
    const group = await groups.create(groupOf());
    const first = await join().run({ actorId: ACTOR, classGroupId: group.id, studentId: STUDENT });
    await leave().run({ actorId: ACTOR, entryId: first.id, reason: "withdrawn" });
    const second = await join().run({ actorId: ACTOR, classGroupId: group.id, studentId: STUDENT });
    expect(second.id).not.toBe(first.id);
  });
});
