import { describe, expect, it } from "vitest";
import {
  limaDayAndHour,
  renewalEndDayDueAt,
  SendCourseEndingRenewalUseCase,
  type EmailNotification,
  type EnrollmentEmailContext,
  type EndingEnrollment,
  type ICourseEndingRenewalRepository,
} from "@ooc/domain";

/** The renewal e-mail (OOC-53): seven days before the class group ends, from 09:00 Lima. */

describe("the Lima clock", () => {
  it("reads the day and the hour in Lima (UTC−5), not in UTC", () => {
    // 03:30 UTC on the 8th is 22:30 of the 7th in Lima.
    expect(limaDayAndHour(new Date("2026-12-08T03:30:00Z"))).toEqual({ day: "2026-12-07", hour: 22 });
    expect(limaDayAndHour(new Date("2026-12-08T14:00:00Z"))).toEqual({ day: "2026-12-08", hour: 9 });
  });

  it("is due from 09:00 Lima, for the class groups ending seven days later", () => {
    expect(renewalEndDayDueAt(new Date("2026-12-08T13:59:59Z"))).toBeNull(); // 08:59 Lima
    expect(renewalEndDayDueAt(new Date("2026-12-08T14:00:00Z"))).toBe("2026-12-15"); // 09:00 Lima
    expect(renewalEndDayDueAt(new Date("2026-12-09T04:59:00Z"))).toBe("2026-12-15"); // 23:59 Lima, same day
  });

  it("crosses months and years", () => {
    expect(renewalEndDayDueAt(new Date("2026-12-28T15:00:00Z"))).toBe("2027-01-04");
    expect(renewalEndDayDueAt(new Date("2027-02-25T15:00:00Z"))).toBe("2027-03-04");
  });
});

const CONTEXT: EnrollmentEmailContext = {
  student: { firstName: "Rosa", lastName: "Quispe", email: "rosa@gmail.com", birthDate: new Date("2014-05-01T00:00:00Z") },
  guardian: { firstName: "Carmen", email: "carmen@example.com" },
  courseName: "Inglés Básico",
  classGroupStartsOn: new Date("2026-09-01T05:00:00Z"),
};

class FakeRepository implements ICourseEndingRenewalRepository {
  asked: string[] = [];
  written = new Map<string, EmailNotification>();
  constructor(private readonly ending: EndingEnrollment[]) {}
  listEndingOn(day: string): Promise<EndingEnrollment[]> {
    this.asked.push(day);
    return Promise.resolve(this.ending);
  }
  findEmailContext(): Promise<EnrollmentEmailContext | null> {
    return Promise.resolve(CONTEXT);
  }
  queue(emails: EmailNotification[]): Promise<number> {
    let fresh = 0;
    for (const email of emails) {
      if (this.written.has(email.dedupeKey)) continue;
      this.written.set(email.dedupeKey, email);
      fresh += 1;
    }
    return Promise.resolve(fresh);
  }
}

const ENDING: EndingEnrollment = { enrollmentId: "e1", studentId: "s1", classGroupId: "g1", endsOn: new Date("2026-12-15T05:00:00Z") };

describe("SendCourseEndingRenewalUseCase", () => {
  it("reads nothing before nine", async () => {
    const repository = new FakeRepository([ENDING]);
    const send = new SendCourseEndingRenewalUseCase(repository);
    expect(await send.run({ locale: "es-PE", now: new Date("2026-12-08T12:00:00Z") })).toEqual({ queued: 0 });
    expect(repository.asked).toEqual([]);
  });

  it("writes the student and a minor's guardian once, however many ticks run that day", async () => {
    const repository = new FakeRepository([ENDING]);
    const send = new SendCourseEndingRenewalUseCase(repository);
    expect(await send.run({ locale: "es-PE", now: new Date("2026-12-08T14:05:00Z") })).toEqual({ queued: 2 });
    expect(await send.run({ locale: "es-PE", now: new Date("2026-12-08T15:05:00Z") })).toEqual({ queued: 0 });
    expect(repository.asked).toEqual(["2026-12-15", "2026-12-15"]);
    expect([...repository.written.keys()]).toEqual([
      "course_ending_renewal:e1:2026-12-15:student",
      "course_ending_renewal:e1:2026-12-15:guardian",
    ]);
    expect(repository.written.get("course_ending_renewal:e1:2026-12-15:student")).toMatchObject({
      templateKey: "course_ending_renewal",
      to: "rosa@gmail.com",
      vars: { recipientName: "Rosa", studentName: "Rosa Quispe", courseName: "Inglés Básico", endsOn: "2026-12-15T05:00:00.000Z" },
    });
  });
});
