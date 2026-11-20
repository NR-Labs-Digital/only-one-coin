import { describe, expect, it } from "vitest";
import {
  academicStatusOf,
  assertFreezable,
  EnrollmentFreezeRefusedError,
  reengagementMilestone,
  takesBack,
  type FreezeSource,
  type LiveFreeze,
  type ReturnRun,
} from "@ooc/domain";

const SOURCE: FreezeSource = {
  id: "e1",
  studentId: "s1",
  seatStatus: "confirmed",
  classGroupId: "g1",
  classGroupStatus: "in_progress",
  classGroupModuleId: "r1",
  module: 2,
  attempt: 1,
  courseAllowsFreeze: true,
};

const FREEZE: LiveFreeze = { freezeId: "f1", enrollmentId: "e1", studentId: "s1", courseId: "c1", module: 2, attempt: 1 };
const RUN: ReturnRun = {
  id: "r9",
  classGroupId: "g9",
  courseId: "c1",
  module: 2,
  open: true,
  code: "A-00009",
  startsOn: null,
  slots: [],
  capacity: 30,
  seatsTaken: 0,
};

describe("enrollment freeze (OOC-84)", () => {
  it("derives the academic status from the seat and the class group", () => {
    expect(academicStatusOf("frozen", "in_progress")).toBe("frozen");
    expect(academicStatusOf("confirmed", "in_progress")).toBe("active");
    expect(academicStatusOf("confirmed", "enrolling")).toBe("active");
    expect(academicStatusOf("confirmed", "finished")).toBe("completed");
    expect(academicStatusOf("confirmed", "closed")).toBe("completed");
    expect(academicStatusOf("reserved", "in_progress")).toBeNull();
    expect(academicStatusOf("released", "in_progress")).toBeNull();
  });

  it("freezes only a confirmed seat, of a course that allows it, in a running class group", () => {
    expect(() => assertFreezable(SOURCE)).not.toThrow();
    const refusal = (source: FreezeSource) => {
      try {
        assertFreezable(source);
      } catch (error) {
        return error instanceof EnrollmentFreezeRefusedError ? error.reason : "other";
      }
      return null;
    };
    expect(refusal({ ...SOURCE, seatStatus: "reserved" })).toBe("enrollment.freeze_seat_not_confirmed");
    expect(refusal({ ...SOURCE, seatStatus: "frozen" })).toBe("enrollment.freeze_seat_not_confirmed");
    expect(refusal({ ...SOURCE, courseAllowsFreeze: false })).toBe("enrollment.freeze_course_disallows");
    expect(refusal({ ...SOURCE, classGroupStatus: "finished" })).toBe("enrollment.freeze_class_group_not_running");
  });

  it("comes back only to an open run of the same course and module", () => {
    expect(takesBack(FREEZE, RUN)).toBe(true);
    expect(takesBack(FREEZE, { ...RUN, module: 3 })).toBe(false);
    expect(takesBack(FREEZE, { ...RUN, courseId: "c2" })).toBe(false);
    expect(takesBack(FREEZE, { ...RUN, open: false })).toBe(false);
    expect(takesBack({ ...FREEZE, module: null }, { ...RUN, module: null })).toBe(true);
  });

  it("re-engages at 1, 3 and 6 months, the latest reached only, then never again", () => {
    expect(reengagementMilestone(0)).toBeNull();
    expect(reengagementMilestone(1)).toBe(1);
    expect(reengagementMilestone(2)).toBe(1);
    expect(reengagementMilestone(3)).toBe(3);
    expect(reengagementMilestone(5)).toBe(3);
    expect(reengagementMilestone(6)).toBe(6);
    expect(reengagementMilestone(20)).toBe(6);
  });
});
