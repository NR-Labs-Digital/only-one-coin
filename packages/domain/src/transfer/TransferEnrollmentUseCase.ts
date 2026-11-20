import { EnrollmentNotFoundError } from "../enrollment/errors.js";
import { newPortalToken, type PortalAccessOutcome } from "../identity/portal/PortalAccess.js";
import { portalCredentialsEmail } from "../identity/portal/portalEmails.js";
import { guardianProvisioning } from "../identity/portal/guardianAccess.js";
import type { IPortalAccessRepository, IPortalLinkBuilder } from "../identity/portal/ports.js";
import type { AuditLogEntry } from "../identity/ports/IAuditLogRepository.js";
import { DEFAULT_LOCALE } from "../notification/EmailNotification.js";
import { BaseUseCase } from "../shared/base/BaseUseCase.js";
import { Student } from "../student/Student.js";
import { EnrollmentTransferRefusedError, EnrollmentTransferStudentNotFoundError } from "./errors.js";

/*
 * Traspaso de matrícula (OOC-105, decisions of 20/11/2026 with Miguel — to be
 * confirmed with the owner): the enrollment is handed to another person.
 *
 * - **The person changes in place.** `enrollments.student_id` points at the
 *   destination; the seat, the class group, the frozen price, the payment and
 *   the monthly modules already bought go with it. The trail keeps who held it.
 * - **Free, staff's tool.** docs/REGRAS-NEGOCIO.md §5 lists it as free; the
 *   same three who move and freeze a seat do it, with a mandatory reason.
 * - **Only onto a student already on file.** Registering a person carries the
 *   guardian's consent (CLAUDE.md §8) and is its own flow, as for the manual
 *   enrollment. A minor whose consent is still pending gets it through the
 *   portal (OOC-72), like any other file.
 * - **What belongs to the person stays with the person:** a grade, or an open
 *   paid procedure, holds the enrollment where it is.
 * - **The destination gets the portal** as a first approval would give it
 *   (`provision`: nothing when the file already has an account).
 */

export const TRANSFER_REASON_MAX_LENGTH = 500;

/** The enrollment as the transfer needs it, read before the write. */
export interface TransferSource {
  id: string;
  studentId: string;
  seatStatus: string;
  classGroupId: string;
  classGroupStatus: string;
  /** The course of the enrollment's plan — what it bought. */
  courseId: string;
  courseAllowsEnrollmentTransfer: boolean;
  courseMinAge: number;
  /** Any grade (or DA) on the enrollment, in any module or attempt. */
  graded: boolean;
  /** A procedure request still `requested` or `paid` on the enrollment. */
  procedureOpen: boolean;
}

/** The student the enrollment would go to. */
export interface TransferDestination {
  id: string;
  birthDate: Date;
  hasLiveGuardian: boolean;
  /** A live enrollment (not released, not retired) in the course already. */
  enrolledInCourse: boolean;
}

export interface IEnrollmentTransferRepository {
  findSource(enrollmentId: string): Promise<TransferSource | null>;
  /** Null for a missing or retired student. */
  findDestination(studentId: string, courseId: string): Promise<TransferDestination | null>;
  /**
   * One transaction: the enrollment locked and still confirmed, held by
   * `fromStudentId`, ungraded and with no open procedure; the destination
   * locked and still without a live enrollment in the course (else
   * `EnrollmentTransferConflictError`, or the refusal it now meets); the
   * enrollment's `student_id` rewritten; the audit entry.
   */
  transfer(params: {
    enrollmentId: string;
    fromStudentId: string;
    toStudentId: string;
    courseId: string;
    audit: Omit<AuditLogEntry, "targetId">;
  }): Promise<void>;
}

export interface TransferEnrollmentInput {
  actorId: string;
  enrollmentId: string;
  toStudentId: string;
  reason: string;
}

export interface TransferEnrollmentOutput {
  enrollmentId: string;
  studentId: string;
  /** What opening the destination's portal did (`already_linked` when it had one). */
  portalAccess: PortalAccessOutcome;
}

export class TransferEnrollmentUseCase extends BaseUseCase<TransferEnrollmentInput, TransferEnrollmentOutput> {
  constructor(
    private readonly repository: IEnrollmentTransferRepository,
    private readonly portalAccess: IPortalAccessRepository,
    private readonly links: IPortalLinkBuilder,
  ) {
    super();
  }

  async run(input: TransferEnrollmentInput): Promise<TransferEnrollmentOutput> {
    const reason = input.reason.trim();
    if (reason.length === 0 || reason.length > TRANSFER_REASON_MAX_LENGTH) {
      throw new EnrollmentTransferRefusedError("reason_required");
    }

    const source = await this.repository.findSource(input.enrollmentId);
    if (!source) throw new EnrollmentNotFoundError();
    assertTransferable(source);
    if (source.studentId === input.toStudentId) throw new EnrollmentTransferRefusedError("same_student");

    const destination = await this.repository.findDestination(input.toStudentId, source.courseId);
    if (!destination) throw new EnrollmentTransferStudentNotFoundError();
    assertReceivable(destination, source.courseMinAge);

    const now = new Date();
    await this.repository.transfer({
      enrollmentId: source.id,
      fromStudentId: source.studentId,
      toStudentId: destination.id,
      courseId: source.courseId,
      audit: {
        actorId: input.actorId,
        action: "enrollment.transferred",
        // `studentId` is the holder from now on — the bitácora points there.
        metadata: {
          studentId: destination.id,
          fromStudentId: source.studentId,
          classGroupId: source.classGroupId,
          reason,
        },
        at: now,
      },
    });

    // The seat is confirmed, so the destination is an enrolled student now:
    // the portal opens as on a first approval. Its own transaction, after the
    // transfer — the seat changed hands whatever happens to the account.
    const activation = newPortalToken("activation", now);
    const portalAccess = await this.portalAccess.provision({
      studentId: destination.id,
      actorId: input.actorId,
      activation,
      at: now,
      notify: (account, tokenId) => [
        portalCredentialsEmail(account, this.links.access(activation.token, DEFAULT_LOCALE), tokenId, DEFAULT_LOCALE),
      ],
      guardian: guardianProvisioning(this.links, now),
    });

    return { enrollmentId: source.id, studentId: destination.id, portalAccess };
  }
}

/** The enrollment's half of the rules — shared by the use case and the repository's re-check. */
export function assertTransferable(source: TransferSource): void {
  if (source.seatStatus !== "confirmed") throw new EnrollmentTransferRefusedError("seat_not_confirmed");
  if (!source.courseAllowsEnrollmentTransfer) throw new EnrollmentTransferRefusedError("course_disallows");
  if (source.classGroupStatus !== "enrolling" && source.classGroupStatus !== "in_progress") {
    throw new EnrollmentTransferRefusedError("class_group_not_running");
  }
  if (source.graded) throw new EnrollmentTransferRefusedError("graded");
  if (source.procedureOpen) throw new EnrollmentTransferRefusedError("procedure_open");
}

/** The destination's half: one seat per course, the course's minimum age, a guardian for a minor. */
export function assertReceivable(destination: TransferDestination, courseMinAge: number): void {
  if (destination.enrolledInCourse) throw new EnrollmentTransferRefusedError("student_already_enrolled");
  if (Student.ageOf(destination.birthDate) < courseMinAge) {
    throw new EnrollmentTransferRefusedError("student_below_minimum_age");
  }
  if (Student.isMinorBornOn(destination.birthDate) && !destination.hasLiveGuardian) {
    throw new EnrollmentTransferRefusedError("guardian_required");
  }
}
