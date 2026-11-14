import type { IAuditLogRepository } from "../identity/ports/IAuditLogRepository.js";
import { BaseUseCase } from "../shared/base/BaseUseCase.js";
import type { SeatStatus } from "./Enrollment.js";
import {
  EnrollmentMoveRefusedError,
  EnrollmentNotFoundError,
  PlanPriceNotFoundError,
} from "./errors.js";
import type { IPlanPriceLookup } from "./PlanPriceLookup.js";

/** The enrollment as the move needs it, read before the write. */
export interface EnrollmentMoveSource {
  id: string;
  studentId: string;
  classGroupId: string;
  courseId: string;
  seatStatus: SeatStatus;
  /** A final grade (or DA) is already recorded on the current class group. */
  graded: boolean;
}

/** The class group the seat would go to. Null from the port when it is not live. */
export interface EnrollmentMoveTarget {
  id: string;
  courseId: string;
  /** Enrolling or in progress, not retired, course and period not retired. */
  open: boolean;
}

/**
 * Everything the move reads and writes. `move` is one transaction: the
 * enrollment is locked and re-checked (same class group, seat not released),
 * the seat is taken on the target — regular first, above capacity only with
 * `allowOverCapacity` — and handed back on the source, to the counter it came
 * from. Throws ClassGroupFullError when the target is full without the
 * confirmation, and EnrollmentMoveConflictError when the enrollment changed
 * since `findSource`.
 */
export interface IEnrollmentMoveRepository {
  findSource(enrollmentId: string): Promise<EnrollmentMoveSource | null>;
  findTarget(classGroupId: string): Promise<EnrollmentMoveTarget | null>;
  /** The course a live plan belongs to, or null for a missing or retired plan. */
  findPlanCourse(planId: string): Promise<string | null>;
  move(params: {
    enrollmentId: string;
    fromClassGroupId: string;
    toClassGroupId: string;
    /** Null keeps the frozen price: the course did not change. */
    planPriceId: string | null;
    allowOverCapacity: boolean;
  }): Promise<{ overCapacity: boolean; movedAt: Date }>;
}

export interface MoveEnrollmentInput {
  actorId: string;
  enrollmentId: string;
  classGroupId: string;
  /** Required exactly when the target is another course. */
  planId: string | null;
  allowOverCapacity: boolean;
  reason: string;
}

export interface MoveEnrollmentOutput {
  enrollmentId: string;
  classGroupId: string;
  overCapacity: boolean;
  planChanged: boolean;
}

export const MOVE_REASON_MAX_LENGTH = 500;

/**
 * Staff moves an enrollment to another class group (OOC-84, decisions of
 * 14/11/2026): a staff tool, free of charge and outside the paid "cambio de
 * horario" rules, to any class group of any course.
 *
 * - **The money never moves.** The payment stays as it is: nothing is charged
 *   or refunded by the platform. Another course needs a plan of that course,
 *   and the enrollment points at its price in force from now on — that is the
 *   price a next monthly module reads. A difference is settled outside.
 * - **A full target asks first** (OOC-155): without `allowOverCapacity` it is
 *   refused, with it the seat goes above capacity.
 * - **A graded enrollment stays.** The grade belongs to the class group it was
 *   given in, and moving the seat would leave it pointing at nobody's roster.
 * - **A released seat is not a seat** — there is nothing to move.
 *
 * The reason is mandatory and goes to the trail with the move.
 */
export class MoveEnrollmentUseCase extends BaseUseCase<MoveEnrollmentInput, MoveEnrollmentOutput> {
  constructor(
    private readonly repository: IEnrollmentMoveRepository,
    private readonly planPriceLookup: IPlanPriceLookup,
    private readonly auditLog: IAuditLogRepository,
  ) {
    super();
  }

  async run(input: MoveEnrollmentInput): Promise<MoveEnrollmentOutput> {
    const reason = input.reason.trim();
    if (reason.length === 0 || reason.length > MOVE_REASON_MAX_LENGTH) {
      throw new EnrollmentMoveRefusedError("reason_required");
    }

    const source = await this.repository.findSource(input.enrollmentId);
    if (!source) throw new EnrollmentNotFoundError();
    if (source.seatStatus === "released") throw new EnrollmentMoveRefusedError("seat_released");
    if (source.graded) throw new EnrollmentMoveRefusedError("graded");
    if (source.classGroupId === input.classGroupId) throw new EnrollmentMoveRefusedError("same_class_group");

    const target = await this.repository.findTarget(input.classGroupId);
    if (!target || !target.open) throw new EnrollmentMoveRefusedError("target_unavailable");

    const courseChanges = target.courseId !== source.courseId;
    let planPriceId: string | null = null;
    if (courseChanges) {
      if (!input.planId) throw new EnrollmentMoveRefusedError("plan_required");
      const planCourse = await this.repository.findPlanCourse(input.planId);
      if (planCourse !== target.courseId) throw new EnrollmentMoveRefusedError("plan_not_of_course");
      const price = await this.planPriceLookup.findCurrentPrice(input.planId);
      if (!price) throw new PlanPriceNotFoundError();
      planPriceId = price.id;
    } else if (input.planId) {
      // Same course, same plan: changing plans is not what a move is.
      throw new EnrollmentMoveRefusedError("plan_not_allowed");
    }

    const moved = await this.repository.move({
      enrollmentId: source.id,
      fromClassGroupId: source.classGroupId,
      toClassGroupId: target.id,
      planPriceId,
      allowOverCapacity: input.allowOverCapacity,
    });

    await this.auditLog.append({
      actorId: input.actorId,
      action: "enrollment.moved",
      targetId: source.id,
      metadata: {
        studentId: source.studentId,
        fromClassGroupId: source.classGroupId,
        toClassGroupId: target.id,
        planChanged: courseChanges,
        ...(moved.overCapacity ? { overCapacity: true } : {}),
        reason,
      },
      at: moved.movedAt,
    });

    return {
      enrollmentId: source.id,
      classGroupId: target.id,
      overCapacity: moved.overCapacity,
      planChanged: courseChanges,
    };
  }
}
