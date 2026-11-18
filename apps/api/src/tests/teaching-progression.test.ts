import {
  ApplyOwnProgressionUseCase,
  ApplyProgressionUseCase,
  GetOwnClassGroupUseCase,
  PreviewOwnProgressionUseCase,
  PreviewProgressionUseCase,
  Teacher,
  type IProgressionRepository,
  type ITeacherRepository,
  type ITeachingReader,
  type ProgressionSeat,
  type TeachingClassGroup,
} from "@ooc/domain";
import { describe, expect, it } from "vitest";
import { FakePlatformSettings, TEST_SETTINGS } from "./fakes/platformSettings.js";

/**
 * OOC-156, part 2: moving the students of a module run on. The grade decides
 * who may advance; repeating stays in the run; the next run must exist; the
 * teacher never forces and coordination forces only with a reason.
 */

const ACCOUNT = "usr_progression_teacher";
const TEACHER = "018f2b5c-1560-7000-8000-0000000000a1";
const GROUP = "018f2b5c-1560-7000-8000-000000000011";
const RUN_1 = "018f2b5c-1560-7000-8000-000000000021";
const RUN_2 = "018f2b5c-1560-7000-8000-000000000022";
const ROSA = "018f2b5c-1560-7000-8000-0000000000e1"; // 16, passed
const LUIS = "018f2b5c-1560-7000-8000-0000000000e2"; // 11, below
const ANA = "018f2b5c-1560-7000-8000-0000000000e3"; // DA
const JUAN = "018f2b5c-1560-7000-8000-0000000000e4"; // not graded yet

function file(): Teacher {
  return new Teacher({
    ...Teacher.create({
      firstName: "Ana",
      lastName: "Docente",
      nationalIdType: "DNI",
      nationalId: "15634567",
      email: "ana.progression@example.com",
      phone: "+51900000156",
      nationality: "PE",
      country: "PE",
      region: "Lima",
      city: "Lima",
      addressLine: "Av. Prueba 156",
      languages: ["Inglés"],
      availability: [],
    }),
    id: TEACHER,
    userId: ACCOUNT,
  });
}

function run(overrides: Partial<TeachingClassGroup> = {}): TeachingClassGroup {
  return {
    id: RUN_1,
    classGroupId: GROUP,
    teacherId: TEACHER,
    code: "A-00156",
    courseName: "Inglés Básico",
    language: "Inglés",
    academicPeriodName: "Ciclo 2026-IV",
    slots: [],
    startsOn: new Date("2026-10-01T05:00:00.000Z"),
    endsOn: new Date("2026-11-30T05:00:00.000Z"),
    capacity: 20,
    seatsTaken: 4,
    status: "finished",
    retired: false,
    classroomLinks: [],
    meetUrl: null,
    module: 1,
    moduleMaterialUrl: null,
    fullCourse: false,
    courseMaterialUrls: [],
    ...overrides,
  };
}

const SEATS: ProgressionSeat[] = [
  { enrollmentId: ROSA, firstName: "Rosa", lastName: "A", attempt: 1, grade: { kind: "score", score: 16 } },
  { enrollmentId: LUIS, firstName: "Luis", lastName: "B", attempt: 1, grade: { kind: "score", score: 11 } },
  { enrollmentId: ANA, firstName: "Ana", lastName: "C", attempt: 2, grade: { kind: "did_not_sit" } },
  { enrollmentId: JUAN, firstName: "Juan", lastName: "D", attempt: 1, grade: null },
];

class FakeProgression implements IProgressionRepository {
  applied: Parameters<IProgressionRepository["apply"]>[0][] = [];
  next: { id: string; module: number } | null = { id: RUN_2, module: 2 };
  modules = 4;
  conflictNext = false;

  async seatsOf() {
    return SEATS;
  }

  async runOfModule(_classGroupId: string, module: number) {
    return this.next && this.next.module === module ? this.next : null;
  }

  async courseModules() {
    return this.modules;
  }

  async apply(params: Parameters<IProgressionRepository["apply"]>[0]) {
    if (this.conflictNext) return { conflicts: [params.advance[0]!.enrollmentId] };
    this.applied.push(params);
    return { advanced: params.advance.length, repeated: params.repeat.length };
  }
}

function setUp(options: { status?: TeachingClassGroup["status"]; requires?: boolean; module?: number } = {}) {
  const teachers = { findByUserId: async () => file() } as unknown as ITeacherRepository;
  const group = run({ status: options.status ?? "finished", module: options.module ?? 1 });
  const reader = { findClassGroup: async (id: string) => (id === RUN_1 ? group : null) } as unknown as ITeachingReader;
  const repository = new FakeProgression();
  const settings = new FakePlatformSettings({
    ...TEST_SETTINGS,
    progressionRequiresPassingGrade: options.requires ?? true,
  });
  const get = new GetOwnClassGroupUseCase(teachers, reader);
  return {
    repository,
    previewOwn: new PreviewOwnProgressionUseCase(get, repository, settings),
    applyOwn: new ApplyOwnProgressionUseCase(get, repository, settings),
    preview: new PreviewProgressionUseCase(reader, repository, settings),
    apply: new ApplyProgressionUseCase(reader, repository, settings),
  };
}

const own = { userId: ACCOUNT, classGroupId: RUN_1 };
const any = { actorId: "usr_coord", classGroupId: GROUP, classGroupModuleId: RUN_1 };

describe("Progression preview", () => {
  it("says who passed, who did not and why, and where they would go", async () => {
    const { previewOwn } = setUp();
    const preview = await previewOwn.run(own);
    expect(preview).toMatchObject({
      classGroupId: GROUP,
      classGroupModuleId: RUN_1,
      module: 1,
      next: { id: RUN_2, module: 2 },
      lastModule: false,
      passingGrade: TEST_SETTINGS.passingGrade,
      requiresPassingGrade: true,
    });
    expect(preview.seats.map((seat) => [seat.firstName, seat.verdict])).toEqual([
      ["Rosa", "passed"],
      ["Luis", "below_passing"],
      ["Ana", "did_not_sit"],
      ["Juan", "not_graded"],
    ]);
  });

  it("knows the last module has nowhere to go", async () => {
    const { repository, preview } = setUp({ module: 4 });
    repository.next = null;
    await expect(preview.run(any)).resolves.toMatchObject({ next: null, lastModule: true });
  });

  it("answers not-found for a run of another class group", async () => {
    const { preview } = setUp();
    await expect(preview.run({ ...any, classGroupId: "018f2b5c-1560-7000-8000-0000000000ff" })).rejects.toMatchObject({
      reason: "catalog.class_group_not_found",
    });
  });
});

describe("Teacher moving their own run on", () => {
  it("advances who passed and repeats who did not, on the attempt each is on, and audits who", async () => {
    const { applyOwn, repository } = setUp();
    await expect(applyOwn.run({ ...own, advance: [ROSA], repeat: [LUIS, ANA] })).resolves.toEqual({
      advanced: 1,
      repeated: 2,
    });
    const [applied] = repository.applied;
    expect(applied).toMatchObject({
      fromRunId: RUN_1,
      toRunId: RUN_2,
      advance: [{ enrollmentId: ROSA, attempt: 1 }],
      repeat: [
        { enrollmentId: LUIS, attempt: 1 },
        { enrollmentId: ANA, attempt: 2 },
      ],
    });
    expect(applied!.audit).toMatchObject({
      actorId: ACCOUNT,
      action: "teaching.progression_applied",
      targetId: GROUP,
      metadata: { classGroupModuleId: RUN_1, toClassGroupModuleId: RUN_2, advanced: [ROSA], repeated: [LUIS, ANA] },
    });
    expect(applied!.audit.metadata).not.toHaveProperty("forced");
  });

  it("never advances below the pass mark while it is required", async () => {
    const { applyOwn, repository } = setUp();
    for (const seat of [LUIS, ANA]) {
      await expect(applyOwn.run({ ...own, advance: [seat], repeat: [] })).rejects.toMatchObject({
        reason: "teaching.progression_below_passing",
      });
    }
    expect(repository.applied).toEqual([]);
  });

  it("advances any graded seat once the pass mark is switched off", async () => {
    const { applyOwn } = setUp({ requires: false });
    await expect(applyOwn.run({ ...own, advance: [LUIS, ANA], repeat: [] })).resolves.toMatchObject({ advanced: 2 });
  });

  it("refuses a seat with no grade, a stranger, the same seat twice and an empty batch", async () => {
    const { applyOwn } = setUp();
    await expect(applyOwn.run({ ...own, advance: [JUAN], repeat: [] })).rejects.toMatchObject({
      reason: "teaching.progression_not_graded",
    });
    await expect(
      applyOwn.run({ ...own, advance: ["018f2b5c-1560-7000-8000-0000000000ee"], repeat: [] }),
    ).rejects.toMatchObject({ reason: "teaching.progression_unknown_enrollment" });
    await expect(applyOwn.run({ ...own, advance: [ROSA], repeat: [ROSA] })).rejects.toMatchObject({
      reason: "teaching.progression_duplicate_enrollment",
    });
    await expect(applyOwn.run({ ...own, advance: [], repeat: [] })).rejects.toMatchObject({
      reason: "teaching.progression_empty",
    });
  });

  it("waits for the next module's run to be opened", async () => {
    const { applyOwn, repository } = setUp();
    repository.next = null;
    await expect(applyOwn.run({ ...own, advance: [ROSA], repeat: [] })).rejects.toMatchObject({
      reason: "teaching.progression_no_next_run",
    });
    // Repeating needs no next run.
    await expect(applyOwn.run({ ...own, advance: [], repeat: [LUIS] })).resolves.toMatchObject({ repeated: 1 });
  });

  it("moves nobody before the class group runs", async () => {
    const { applyOwn } = setUp({ status: "enrolling" });
    await expect(applyOwn.run({ ...own, advance: [ROSA], repeat: [] })).rejects.toMatchObject({
      reason: "teaching.progression_closed",
    });
  });

  it("says when somebody moved a seat meanwhile", async () => {
    const { applyOwn, repository } = setUp();
    repository.conflictNext = true;
    await expect(applyOwn.run({ ...own, advance: [ROSA], repeat: [] })).rejects.toMatchObject({
      reason: "teaching.progression_conflict",
    });
  });
});

describe("Coordination moving any run on", () => {
  it("advances below the pass mark with a reason, and records who was forced and why", async () => {
    const { apply, repository } = setUp();
    await expect(
      apply.run({ ...any, advance: [ROSA, LUIS], repeat: [], reason: "  Recuperó en la práctica  " }),
    ).resolves.toMatchObject({ advanced: 2 });
    expect(repository.applied[0]!.audit.metadata).toMatchObject({
      forced: [LUIS],
      reason: "Recuperó en la práctica",
    });
  });

  it("needs the reason to force", async () => {
    const { apply } = setUp();
    for (const reason of [null, "   ", "x".repeat(501)]) {
      await expect(apply.run({ ...any, advance: [LUIS], repeat: [], reason })).rejects.toMatchObject({
        reason: "teaching.progression_reason_required",
      });
    }
  });
});
