import {
  GetOwnClassGroupUseCase,
  RecordOwnClassGroupGradesUseCase,
  Teacher,
  isValidScore,
  type GradeEntry,
  type IGradeRepository,
  type ITeacherRepository,
  type ITeachingReader,
  type IPlatformSettingsRepository,
  type EmailNotification,
  type TeachingClassGroup,
} from "@ooc/domain";
import { describe, expect, it } from "vitest";

/**
 * OOC-38: posting final grades. The scope (the teacher of the class group,
 * from the session) is shared with every `/teaching` read; here, what is
 * particular to posting — when, for whom, what a grade is, and what a retry
 * and a second, different grade do.
 */

const ACCOUNT = "usr_ooc38";
const TEACHER = "018f2b5c-3800-7000-8000-0000000000a1";
const GROUP = "018f2b5c-3800-7000-8000-000000000011";
const SEAT_A = "018f2b5c-3800-7000-8000-0000000000e1";
const SEAT_B = "018f2b5c-3800-7000-8000-0000000000e2";
const STRANGER = "018f2b5c-3800-7000-8000-0000000000e9";

function file(): Teacher {
  return new Teacher({
    ...Teacher.create({
      firstName: "Ana",
      lastName: "Docente",
      nationalIdType: "DNI",
      nationalId: "38234567",
      email: "ana@example.com",
      phone: "+51900000038",
      nationality: "PE",
      country: "PE",
      region: "Lima",
      city: "Lima",
      addressLine: "Av. Prueba 38",
      languages: ["Inglés"],
      availability: [],
    }),
    id: TEACHER,
    userId: ACCOUNT,
  });
}

function group(status: TeachingClassGroup["status"]): TeachingClassGroup {
  return {
    id: GROUP,
    teacherId: TEACHER,
    code: "A-00038",
    courseName: "Inglés Básico",
    language: "Inglés",
    academicPeriodName: "Ciclo 2026-II",
    slots: [],
    startsOn: new Date("2026-10-01T05:00:00.000Z"),
    endsOn: new Date("2026-11-30T05:00:00.000Z"),
    capacity: 20,
    seatsTaken: 2,
    status,
    retired: false,
    classroomUrl: null,
    module: 1,
    moduleMaterialUrl: null,
    fullCourse: false,
    courseMaterialUrls: [],
  };
}

class FakeGrades implements IGradeRepository {
  posted = new Map<string, GradeEntry["value"]>();
  audits: unknown[] = [];
  emails: EmailNotification[] = [];

  async listForClassGroup() {
    return [];
  }

  async emailFacts(_classGroupId: string, enrollmentIds: string[]) {
    return enrollmentIds
      .filter((id) => id === SEAT_A || id === SEAT_B)
      .map((enrollmentId) => ({
        enrollmentId,
        student: {
          firstName: enrollmentId === SEAT_A ? "Rosa" : "Luis",
          lastName: "Quispe",
          email: `${enrollmentId === SEAT_A ? "rosa" : "luis"}@gmail.com`,
          // Luis is a minor: his guardian hears it too.
          birthDate: enrollmentId === SEAT_A ? new Date("2000-01-01") : new Date(Date.now() - 12 * 365 * 86_400_000),
        },
        guardian: enrollmentId === SEAT_B ? { firstName: "Carmen", email: "carmen@example.com" } : null,
        courseName: "Inglés Básico",
      }));
  }

  async record(params: Parameters<IGradeRepository["record"]>[0]) {
    const conflicts = params.entries.filter((entry) => {
      const posted = this.posted.get(entry.enrollmentId);
      return posted && JSON.stringify(posted) !== JSON.stringify(entry.value);
    });
    if (conflicts.length > 0) return { conflicts: conflicts.map((entry) => entry.enrollmentId) };
    const fresh = params.entries.filter((entry) => !this.posted.has(entry.enrollmentId));
    for (const entry of fresh) this.posted.set(entry.enrollmentId, entry.value);
    if (fresh.length > 0) {
      this.audits.push(params.audit(fresh));
      this.emails.push(...params.emails(fresh));
    }
    return { recorded: fresh.length, alreadyRecorded: params.entries.length - fresh.length };
  }
}

function setUp(status: TeachingClassGroup["status"] = "finished") {
  const teachers = { findByUserId: async () => file() } as unknown as ITeacherRepository;
  const reader = {
    findClassGroup: async () => group(status),
    listStudents: async () => [
      { enrollmentId: SEAT_A, firstName: "Rosa", lastName: "Quispe" },
      { enrollmentId: SEAT_B, firstName: "Luis", lastName: "Huamán" },
    ],
  } as unknown as ITeachingReader;
  const grades = new FakeGrades();
  const settings = { get: async () => ({ passingGrade: 12 }) } as unknown as IPlatformSettingsRepository;
  const useCase = new RecordOwnClassGroupGradesUseCase(
    new GetOwnClassGroupUseCase(teachers, reader),
    reader,
    grades,
    settings,
  );
  return { useCase, grades };
}

const post = (entries: GradeEntry[]) => ({ userId: ACCOUNT, classGroupId: GROUP, entries });
const score = (enrollmentId: string, value: number): GradeEntry => ({ enrollmentId, value: { kind: "score", score: value } });
const da = (enrollmentId: string): GradeEntry => ({ enrollmentId, value: { kind: "did_not_sit" } });

describe("RecordOwnClassGroupGradesUseCase", () => {
  it("posts a batch — grades and DA — and audits the seats, never the grades", async () => {
    const { useCase, grades } = setUp();

    await expect(useCase.run(post([score(SEAT_A, 13.5), da(SEAT_B)]))).resolves.toEqual({
      recorded: 2,
      alreadyRecorded: 0,
    });
    expect(grades.audits).toEqual([
      expect.objectContaining({
        actorId: ACCOUNT,
        action: "teaching.grades_recorded",
        targetId: GROUP,
        metadata: { classGroupId: GROUP, enrollmentIds: [SEAT_A, SEAT_B], didNotSit: 1 },
      }),
    ]);
    expect(JSON.stringify(grades.audits)).not.toContain("13.5");
  });

  it("treats the same grade sent again as done: a retry after a lost connection", async () => {
    const { useCase, grades } = setUp();
    await useCase.run(post([score(SEAT_A, 15)]));

    await expect(useCase.run(post([score(SEAT_A, 15), score(SEAT_B, 9)]))).resolves.toEqual({
      recorded: 1,
      alreadyRecorded: 1,
    });
    expect(grades.audits).toHaveLength(2);
  });

  it("e-mails each grade written to the student, and a minor's guardian, with the configured pass mark", async () => {
    const { useCase, grades } = setUp();

    await useCase.run(post([score(SEAT_A, 13.5), da(SEAT_B)]));

    expect(grades.emails.map((email) => [email.templateKey, email.to])).toEqual([
      ["grade_posted", "rosa@gmail.com"],
      ["grade_did_not_sit", "luis@gmail.com"],
      ["grade_did_not_sit", "carmen@example.com"],
    ]);
    expect(grades.emails[0]).toMatchObject({
      locale: "es-PE",
      vars: { recipientName: "Rosa", courseName: "Inglés Básico", grade: 13.5, passingGrade: 12 },
      dedupeKey: `grade_posted:${GROUP}:${SEAT_A}:student`,
    });
  });

  it("e-mails nobody on a retry that writes nothing", async () => {
    const { useCase, grades } = setUp();
    await useCase.run(post([score(SEAT_A, 15)]));
    const sent = grades.emails.length;

    await useCase.run(post([score(SEAT_A, 15)]));

    expect(grades.emails).toHaveLength(sent);
  });

  it("refuses a different grade on a posted seat: a posted grade is final", async () => {
    const { useCase } = setUp();
    await useCase.run(post([score(SEAT_A, 15)]));

    await expect(useCase.run(post([score(SEAT_A, 16)]))).rejects.toMatchObject({
      status: 409,
      reason: "teaching.grade_already_recorded",
    });
    await expect(useCase.run(post([da(SEAT_A)]))).rejects.toMatchObject({ status: 409 });
  });

  it.each(["draft", "enrolling", "closed"] as const)("refuses posting in a class group that is %s", async (status) => {
    const { useCase, grades } = setUp(status);
    await expect(useCase.run(post([score(SEAT_A, 15)]))).rejects.toMatchObject({
      status: expect.any(Number),
    });
    expect(grades.posted.size).toBe(0);
  });

  it("answers 422 teaching.grading_closed while the class group is only enrolling", async () => {
    const { useCase } = setUp("enrolling");
    await expect(useCase.run(post([score(SEAT_A, 15)]))).rejects.toMatchObject({
      status: 422,
      reason: "teaching.grading_closed",
    });
  });

  it("posts while running, too", async () => {
    const { useCase } = setUp("in_progress");
    await expect(useCase.run(post([score(SEAT_A, 15)]))).resolves.toMatchObject({ recorded: 1 });
  });

  it.each([
    ["a seat that is not a confirmed one here", [score(STRANGER, 15)], "teaching.grade_unknown_enrollment"],
    ["the same student twice", [score(SEAT_A, 15), da(SEAT_A)], "teaching.grade_duplicate_enrollment"],
    ["three decimals", [score(SEAT_A, 13.555)], "teaching.grade_out_of_range"],
    ["a negative grade", [score(SEAT_A, -1)], "teaching.grade_out_of_range"],
    ["nothing", [], "teaching.no_grades"],
  ])("refuses %s, writing nothing", async (_label, entries, reason) => {
    const { useCase, grades } = setUp();
    await expect(useCase.run(post(entries))).rejects.toMatchObject({ status: 422, reason });
    expect(grades.posted.size).toBe(0);
  });
});

describe("isValidScore", () => {
  it.each([0, 20, 13.5, 13.75, 14])("accepts %s", (value) => expect(isValidScore(value)).toBe(true));
  it.each([-0.01, 20.01, 13.555, Number.NaN])("refuses %s", (value) => expect(isValidScore(value)).toBe(false));
});
