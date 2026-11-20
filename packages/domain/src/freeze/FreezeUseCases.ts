import type { AuditLogEntry } from "../identity/ports/IAuditLogRepository.js";
import { EnrollmentNotFoundError } from "../enrollment/errors.js";
import { BaseUseCase } from "../shared/base/BaseUseCase.js";
import { EnrollmentFreezeRefusedError, EnrollmentReturnRefusedError } from "./errors.js";

/*
 * Freezing an enrollment (OOC-84, CLAUDE.md §1, decisions of 20/11/2026):
 *
 * - **The seat goes back** to the class group while the student is away, so
 *   somebody else can take it.
 * - **The student comes back only to the module they stopped in**, with no
 *   deadline. Coming back is staff's: they pick a run of that module, of the
 *   same course, in a class group still open, and the seat is taken there.
 * - **Only where the course allows it** (`courses.allows_freeze` — not
 *   intermedio/avanzado) and only while the class group is selling or running.
 * - **Staff freeze without a fee on the platform**, with a reason in the trail,
 *   like moving a seat. The student's paid request from the portal freezes the
 *   same way once a person approved its payment.
 *
 * Re-engagement e-mails go out 1, 3 and 6 months after the freeze, and then
 * nothing (`EnrollmentFreezeReengagementUseCase`).
 */

export const FREEZE_REASON_MAX_LENGTH = 500;

export interface FreezeSource {
  id: string;
  studentId: string;
  seatStatus: string;
  classGroupId: string;
  classGroupStatus: string;
  classGroupModuleId: string;
  module: number | null;
  attempt: number;
  courseAllowsFreeze: boolean;
}

/** The freeze an enrollment is in now. */
export interface LiveFreeze {
  freezeId: string;
  enrollmentId: string;
  studentId: string;
  courseId: string;
  module: number | null;
  attempt: number;
}

/** A module run the student may come back to. */
export interface ReturnRun {
  id: string;
  classGroupId: string;
  courseId: string;
  module: number | null;
  /** In a class group still enrolling or running, nothing retired. */
  open: boolean;
  /** What the screen shows to pick one. */
  code: string;
  startsOn: Date | null;
  slots: unknown;
  capacity: number;
  /** Normal and above-capacity seats together (OOC-155). */
  seatsTaken: number;
}

export interface IEnrollmentFreezeRepository {
  findSource(enrollmentId: string): Promise<FreezeSource | null>;
  /**
   * One transaction: the enrollment locked and still confirmed in the run it
   * was read in (else `EnrollmentFreezeConflictError`); the seat given back to
   * the counter it held; the seat `frozen`; the freeze row and the audit entry.
   */
  freeze(params: {
    source: FreezeSource;
    frozenBy: string;
    reason: string | null;
    audit: Omit<AuditLogEntry, "targetId">;
  }): Promise<{ freezeId: string }>;
  findLiveFreeze(enrollmentId: string): Promise<LiveFreeze | null>;
  findRun(classGroupModuleId: string): Promise<ReturnRun | null>;
  /** The open runs of a course and module, for the screen to pick from. */
  listReturnRuns(params: { courseId: string; module: number | null }): Promise<ReturnRun[]>;
  /**
   * One transaction: the enrollment locked and still frozen in this freeze
   * (else `EnrollmentFreezeConflictError`); a seat taken in the run's class
   * group atomically — above capacity only with `allowOverCapacity` (else
   * `ClassGroupFullError`); the seat `confirmed` in the run; the return row and
   * the audit entry.
   */
  bringBack(params: {
    freeze: LiveFreeze;
    run: ReturnRun;
    allowOverCapacity: boolean;
    returnedBy: string;
    audit: Omit<AuditLogEntry, "targetId">;
  }): Promise<{ overCapacity: boolean }>;
}

export interface FreezeEnrollmentInput {
  actorId: string;
  enrollmentId: string;
  /** Required from staff (1–500); null when a paid request from the portal freezes. */
  reason: string | null;
}

export class FreezeEnrollmentUseCase extends BaseUseCase<FreezeEnrollmentInput, { freezeId: string }> {
  constructor(
    private readonly repository: IEnrollmentFreezeRepository,
    private readonly requireReason: boolean,
  ) {
    super();
  }

  async run(input: FreezeEnrollmentInput): Promise<{ freezeId: string }> {
    const reason = input.reason?.trim() || null;
    if (this.requireReason && (!reason || reason.length > FREEZE_REASON_MAX_LENGTH)) {
      throw new EnrollmentFreezeRefusedError("reason_required");
    }

    const source = await this.repository.findSource(input.enrollmentId);
    if (!source) throw new EnrollmentNotFoundError();
    assertFreezable(source);

    return this.repository.freeze({
      source,
      frozenBy: input.actorId,
      reason,
      audit: {
        actorId: input.actorId,
        action: "enrollment.frozen",
        metadata: {
          studentId: source.studentId,
          classGroupId: source.classGroupId,
          classGroupModuleId: source.classGroupModuleId,
          module: source.module,
          ...(reason ? { reason } : {}),
        },
        at: new Date(),
      },
    });
  }
}

/** The rule, on its own so the portal's paid request checks it before taking the money too. */
export function assertFreezable(source: FreezeSource): void {
  if (source.seatStatus !== "confirmed") throw new EnrollmentFreezeRefusedError("seat_not_confirmed");
  if (!source.courseAllowsFreeze) throw new EnrollmentFreezeRefusedError("course_disallows");
  if (source.classGroupStatus !== "enrolling" && source.classGroupStatus !== "in_progress") {
    throw new EnrollmentFreezeRefusedError("class_group_not_running");
  }
}

/** Whether a run takes this freeze back: same course, the module it stopped in, still open. */
export function takesBack(freeze: LiveFreeze, run: ReturnRun): boolean {
  return run.open && run.courseId === freeze.courseId && run.module === freeze.module;
}

export interface ReturnFromFreezeInput {
  actorId: string;
  enrollmentId: string;
  classGroupModuleId: string;
  allowOverCapacity: boolean;
}

export class ReturnFromFreezeUseCase extends BaseUseCase<ReturnFromFreezeInput, { overCapacity: boolean }> {
  constructor(private readonly repository: IEnrollmentFreezeRepository) {
    super();
  }

  async run(input: ReturnFromFreezeInput): Promise<{ overCapacity: boolean }> {
    const freeze = await this.repository.findLiveFreeze(input.enrollmentId);
    if (!freeze) throw new EnrollmentReturnRefusedError("not_frozen");

    const run = await this.repository.findRun(input.classGroupModuleId);
    if (!run || !takesBack(freeze, run)) throw new EnrollmentReturnRefusedError("target_unavailable");

    return this.repository.bringBack({
      freeze,
      run,
      allowOverCapacity: input.allowOverCapacity,
      returnedBy: input.actorId,
      audit: {
        actorId: input.actorId,
        action: "enrollment.unfrozen",
        metadata: {
          studentId: freeze.studentId,
          freezeId: freeze.freezeId,
          toClassGroupId: run.classGroupId,
          toClassGroupModuleId: run.id,
          ...(input.allowOverCapacity ? { allowOverCapacity: true } : {}),
        },
        at: new Date(),
      },
    });
  }
}

/** The runs the screen offers for coming back. Not frozen: nothing to offer. */
export class ListReturnRunsUseCase extends BaseUseCase<{ enrollmentId: string }, ReturnRun[]> {
  constructor(private readonly repository: IEnrollmentFreezeRepository) {
    super();
  }

  async run(input: { enrollmentId: string }): Promise<ReturnRun[]> {
    const freeze = await this.repository.findLiveFreeze(input.enrollmentId);
    if (!freeze) throw new EnrollmentReturnRefusedError("not_frozen");
    return this.repository.listReturnRuns({ courseId: freeze.courseId, module: freeze.module });
  }
}
