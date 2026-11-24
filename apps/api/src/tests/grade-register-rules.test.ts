import { lateness, registerDeadline, teacherMayEdit } from "@ooc/domain";
import { describe, expect, it } from "vitest";

/** OOC-180: the register's deadline and who may change grades — rules with no database. */

describe("registerDeadline", () => {
  it("runs the configured hours from the end of the module's last day in Lima", () => {
    // 20/11/2026 ends at 21/11 00:00 in Lima = 05:00 UTC; plus 48 h.
    expect(registerDeadline("2026-11-20", 48)?.toISOString()).toBe("2026-11-23T05:00:00.000Z");
    expect(registerDeadline("2026-11-20", 1)?.toISOString()).toBe("2026-11-21T06:00:00.000Z");
  });

  it("crosses months and years", () => {
    expect(registerDeadline("2026-12-31", 24)?.toISOString()).toBe("2027-01-02T05:00:00.000Z");
  });

  it("has no deadline without an end date", () => {
    expect(registerDeadline(null, 48)).toBeNull();
    expect(registerDeadline("not a date", 48)).toBeNull();
  });
});

describe("lateness", () => {
  const deadlineAt = registerDeadline("2026-11-20", 48);
  const base = { deadlineAt, firstSubmittedAt: null, firstSubmittedEndsOn: null, hours: 48 };

  it("is overdue only while not sent and past the deadline", () => {
    expect(lateness({ ...base, status: "draft", now: new Date("2026-11-23T05:00:01Z") }).overdue).toBe(true);
    expect(lateness({ ...base, status: "draft", now: new Date("2026-11-23T04:59:59Z") }).overdue).toBe(false);
    expect(lateness({ ...base, status: "returned", now: new Date("2026-12-01T00:00:00Z") }).overdue).toBe(false);
    expect(lateness({ ...base, status: "draft", deadlineAt: null, now: new Date("2027-01-01T00:00:00Z") }).overdue).toBe(
      false,
    );
  });

  it("judges a late send by the end date that stood when it was sent", () => {
    const late = lateness({
      ...base,
      status: "in_review",
      firstSubmittedAt: new Date("2026-11-24T00:00:00Z"),
      firstSubmittedEndsOn: "2026-11-20",
      now: new Date("2026-11-25T00:00:00Z"),
    });
    expect(late).toEqual({ overdue: false, submittedLate: true });
    expect(
      lateness({
        ...base,
        status: "official",
        firstSubmittedAt: new Date("2026-11-22T00:00:00Z"),
        firstSubmittedEndsOn: "2026-11-20",
        now: new Date("2026-11-25T00:00:00Z"),
      }).submittedLate,
    ).toBe(false);
  });
});

describe("teacherMayEdit", () => {
  it("is the teacher's while not sent or returned", () => {
    expect(teacherMayEdit("draft")).toBe(true);
    expect(teacherMayEdit("returned")).toBe(true);
    expect(teacherMayEdit("in_review")).toBe(false);
    expect(teacherMayEdit("official")).toBe(false);
  });
});
