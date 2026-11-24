import { CatalogClassGroupNotFoundError } from "../catalog/errors.js";
import type { IPlatformSettingsRepository } from "../platform/ports/IPlatformSettingsRepository.js";
import { BaseUseCase } from "../shared/base/BaseUseCase.js";
import { ConflictError } from "../shared/base/errors/ConflictError.js";
import { UnableToProcessEntryError } from "../shared/base/errors/UnableToProcessEntryError.js";
import type { GetOwnClassGroupUseCase } from "./GetOwnClassGroupUseCase.js";
import type { GradeValue } from "./Grade.js";
import { GRADING_OPEN } from "./gradePosting.js";
import type { ITeachingReader, TeachingClassGroup } from "./TeachingReader.js";

/**
 * Moving students from one module run to the next (OOC-156, decisions of
 * 14/11/2026, to confirm with the owner). The runs of a class group go on in
 * parallel; when a module ends, each student of the run either advances to
 * the run of the next module of the same class group, or repeats the module
 * in the same run. A person always confirms: the system prepares the list.
 *
 * - **The grade decides who may advance.** At or above the pass mark
 *   (`passing_grade`) advances. Below it, or DA, repeats — unless
 *   coordination advances them anyway, with a reason. The pass mark only
 *   gates this while `progression_requires_passing_grade` is on.
 * - **Repeating stays in the run** and opens a new attempt: the grade of the
 *   time before stays in the history, the next one is a grade of its own.
 * - **Only an official grade moves anybody** (OOC-180, decision of
 *   18/11/2026): a grade still in review — its register not yet confirmed by
 *   coordination — neither advances nor repeats the student.
 * - **The next run is opened by the staff.** Without a live run of the next
 *   module there is nowhere to advance to, and the preview says so.
 * - **Who:** the teacher of the run, from the portal, never forcing; and
 *   coordination, from the backoffice, in any run.
 *
 * Monthly English (CLAUDE.md §1) advances like any other enrollment: whether
 * a student who has not paid the next module keeps access to the class is
 * the portal's lock (OOC-86), not progression's.
 */

export type ProgressionVerdict = "passed" | "below_passing" | "did_not_sit" | "not_graded" | "not_official";

export interface ProgressionSeat {
  enrollmentId: string;
  firstName: string;
  lastName: string;
  /** Which time through this run the student is on. */
  attempt: number;
  /** The grade that counts for this attempt, null while none was posted. */
  grade: GradeValue | null;
  /** Its register was confirmed by coordination (OOC-180) — or it predates registers. */
  official: boolean;
}

export interface ProgressionPreviewSeat extends ProgressionSeat {
  verdict: ProgressionVerdict;
}

export interface ProgressionRun {
  id: string;
  module: number;
}

export interface ProgressionPreview {
  classGroupId: string;
  classGroupModuleId: string;
  module: number | null;
  /** The live run of the next module; null when there is none to go to. */
  next: ProgressionRun | null;
  /** The run teaches the course's last module: there is no next one to open. */
  lastModule: boolean;
  passingGrade: number;
  requiresPassingGrade: boolean;
  seats: ProgressionPreviewSeat[];
}

/** Everything progression reads and writes. */
export interface IProgressionRepository {
  /** The confirmed seats in the run now, surname order, with their current attempt's grade. */
  seatsOf(classGroupModuleId: string): Promise<ProgressionSeat[]>;
  /** The live run of `module` in the class group, or null. */
  runOfModule(classGroupId: string, module: number): Promise<ProgressionRun | null>;
  /** How many modules the class group's course has. */
  courseModules(classGroupId: string): Promise<number>;
  /**
   * One transaction. Each seat is re-checked as the write runs — still
   * confirmed, still in `fromRunId`, still on the attempt it was read on — so
   * two people advancing the same run never move a student twice. `conflicts`
   * names the seats that changed meanwhile, and nothing is written then.
   * Advancing points the seat at `toRunId` with attempt 1 plus the grades it
   * already has there; repeating adds one to its attempt.
   */
  apply(params: {
    fromRunId: string;
    toRunId: string | null;
    advance: { enrollmentId: string; attempt: number }[];
    repeat: { enrollmentId: string; attempt: number }[];
    audit: ReturnType<typeof progressionAudit>;
  }): Promise<{ advanced: number; repeated: number } | { conflicts: string[] }>;
}

export function verdictOf(grade: GradeValue | null, passingGrade: number, official = true): ProgressionVerdict {
  if (grade === null) return "not_graded";
  if (!official) return "not_official";
  if (grade.kind === "did_not_sit") return "did_not_sit";
  return grade.score >= passingGrade ? "passed" : "below_passing";
}

function progressionAudit(params: {
  actorId: string;
  run: TeachingClassGroup;
  toRunId: string | null;
  advanced: string[];
  repeated: string[];
  forced: string[];
  reason: string | null;
}) {
  return {
    actorId: params.actorId,
    action: "teaching.progression_applied",
    targetId: params.run.classGroupId,
    metadata: {
      classGroupModuleId: params.run.id,
      toClassGroupModuleId: params.toRunId,
      advanced: params.advanced,
      repeated: params.repeated,
      ...(params.forced.length > 0 ? { forced: params.forced, reason: params.reason } : {}),
    },
    at: new Date(),
  };
}

interface ProgressionDeps {
  repository: IProgressionRepository;
  settings: IPlatformSettingsRepository;
}

async function previewOf(deps: ProgressionDeps, run: TeachingClassGroup): Promise<ProgressionPreview> {
  const [seats, settings, courseModules] = await Promise.all([
    deps.repository.seatsOf(run.id),
    deps.settings.get(),
    deps.repository.courseModules(run.classGroupId),
  ]);
  const next = run.module === null ? null : await deps.repository.runOfModule(run.classGroupId, run.module + 1);
  return {
    classGroupId: run.classGroupId,
    classGroupModuleId: run.id,
    module: run.module,
    next,
    lastModule: run.module !== null && run.module >= courseModules,
    passingGrade: settings.passingGrade,
    requiresPassingGrade: settings.progressionRequiresPassingGrade,
    seats: seats.map((seat) => ({ ...seat, verdict: verdictOf(seat.grade, settings.passingGrade, seat.official) })),
  };
}

const MAX_REASON_LENGTH = 500;

function refuse(reason: string, message: string): never {
  throw new UnableToProcessEntryError({ reason: `teaching.progression_${reason}`, message });
}

export interface ApplyProgressionInput {
  actorId: string;
  /** Seats that advance to the next module. */
  advance: string[];
  /** Seats that repeat the module in the same run. */
  repeat: string[];
  /** Why seats below the pass mark advance anyway — coordination only. */
  reason?: string | null;
}

async function applyTo(
  deps: ProgressionDeps,
  run: TeachingClassGroup,
  input: ApplyProgressionInput,
  canForce: boolean,
): Promise<{ advanced: number; repeated: number }> {
  if (!GRADING_OPEN.has(run.status)) refuse("closed", "Students move on once the class group is running.");
  if (input.advance.length + input.repeat.length === 0) refuse("empty", "Nobody to move.");

  const preview = await previewOf(deps, run);
  const bySeat = new Map(preview.seats.map((seat) => [seat.enrollmentId, seat]));
  const seen = new Set<string>();
  const forced: string[] = [];

  for (const enrollmentId of [...input.advance, ...input.repeat]) {
    const seat = bySeat.get(enrollmentId);
    if (!seat) refuse("unknown_enrollment", "Not a confirmed seat in this run.");
    if (seen.has(enrollmentId)) refuse("duplicate_enrollment", "The same student twice.");
    seen.add(enrollmentId);
    if (seat.verdict === "not_graded") refuse("not_graded", "A student moves on once their grade is posted.");
    if (seat.verdict === "not_official") {
      refuse("not_official", "A student moves on once coordination confirms the grade register.");
    }
  }

  if (input.advance.length > 0) {
    if (preview.next === null) refuse("no_next_run", "The next module has no group open in this class group.");
    for (const enrollmentId of input.advance) {
      if (bySeat.get(enrollmentId)!.verdict !== "passed" && preview.requiresPassingGrade) forced.push(enrollmentId);
    }
  }

  const reason = input.reason?.trim() || null;
  if (forced.length > 0) {
    if (!canForce) refuse("below_passing", "Only coordination advances a student below the pass mark.");
    if (!reason || reason.length > MAX_REASON_LENGTH) {
      refuse("reason_required", "Advancing below the pass mark needs a reason, up to 500 characters.");
    }
  }

  const attemptOf = (enrollmentId: string) => ({ enrollmentId, attempt: bySeat.get(enrollmentId)!.attempt });
  const result = await deps.repository.apply({
    fromRunId: run.id,
    toRunId: input.advance.length > 0 ? preview.next!.id : null,
    advance: input.advance.map(attemptOf),
    repeat: input.repeat.map(attemptOf),
    audit: progressionAudit({
      actorId: input.actorId,
      run,
      toRunId: input.advance.length > 0 ? preview.next!.id : null,
      advanced: input.advance,
      repeated: input.repeat,
      forced,
      reason,
    }),
  });

  if ("conflicts" in result) {
    throw new ConflictError({
      reason: "teaching.progression_conflict",
      message: "Somebody moved one of these students meanwhile. Reload and try again.",
    });
  }
  return result;
}

/** The teacher's own run: what the portal's progression panel reads. Another teacher's run is a 404. */
export class PreviewOwnProgressionUseCase extends BaseUseCase<{ userId: string; classGroupId: string }, ProgressionPreview> {
  constructor(
    private readonly getOwnClassGroup: GetOwnClassGroupUseCase,
    private readonly repository: IProgressionRepository,
    private readonly settings: IPlatformSettingsRepository,
  ) {
    super();
  }

  async run(input: { userId: string; classGroupId: string }): Promise<ProgressionPreview> {
    const run = await this.getOwnClassGroup.run(input);
    return previewOf({ repository: this.repository, settings: this.settings }, run);
  }
}

/** The teacher moves the students of their own run. Never below the pass mark while it is required. */
export type ApplyOwnProgressionInput = Omit<ApplyProgressionInput, "actorId" | "reason"> & {
  userId: string;
  classGroupId: string;
};

export class ApplyOwnProgressionUseCase extends BaseUseCase<
  ApplyOwnProgressionInput,
  { advanced: number; repeated: number }
> {
  constructor(
    private readonly getOwnClassGroup: GetOwnClassGroupUseCase,
    private readonly repository: IProgressionRepository,
    private readonly settings: IPlatformSettingsRepository,
  ) {
    super();
  }

  async run(input: ApplyOwnProgressionInput) {
    const run = await this.getOwnClassGroup.run(input);
    // The teacher never forces, so a reason from them has nothing to justify.
    return applyTo(
      { repository: this.repository, settings: this.settings },
      run,
      { actorId: input.userId, advance: input.advance, repeat: input.repeat, reason: null },
      false,
    );
  }
}

async function anyRun(reader: ITeachingReader, classGroupId: string, classGroupModuleId: string): Promise<TeachingClassGroup> {
  const run = await reader.findClassGroup(classGroupModuleId);
  if (!run || run.classGroupId !== classGroupId || run.retired) throw new CatalogClassGroupNotFoundError();
  return run;
}

/** Coordination's preview of any run. */
export class PreviewProgressionUseCase extends BaseUseCase<
  { classGroupId: string; classGroupModuleId: string },
  ProgressionPreview
> {
  constructor(
    private readonly reader: ITeachingReader,
    private readonly repository: IProgressionRepository,
    private readonly settings: IPlatformSettingsRepository,
  ) {
    super();
  }

  async run(input: { classGroupId: string; classGroupModuleId: string }): Promise<ProgressionPreview> {
    const run = await anyRun(this.reader, input.classGroupId, input.classGroupModuleId);
    return previewOf({ repository: this.repository, settings: this.settings }, run);
  }
}

/** Coordination moves the students of any run — below the pass mark too, with a reason. */
export class ApplyProgressionUseCase extends BaseUseCase<
  ApplyProgressionInput & { classGroupId: string; classGroupModuleId: string },
  { advanced: number; repeated: number }
> {
  constructor(
    private readonly reader: ITeachingReader,
    private readonly repository: IProgressionRepository,
    private readonly settings: IPlatformSettingsRepository,
  ) {
    super();
  }

  async run(input: ApplyProgressionInput & { classGroupId: string; classGroupModuleId: string }) {
    const run = await anyRun(this.reader, input.classGroupId, input.classGroupModuleId);
    return applyTo({ repository: this.repository, settings: this.settings }, run, input, true);
  }
}
