import { BaseUseCase } from "../shared/base/BaseUseCase.js";
import { NotFoundError } from "../shared/base/errors/NotFoundError.js";
import { UnableToProcessEntryError } from "../shared/base/errors/UnableToProcessEntryError.js";
import type { ITeacherRepository } from "../teacher/TeacherRepository.js";
import { TeacherInviteRefusedError } from "./errors.js";
import type { IAuditLogRepository } from "./ports/IAuditLogRepository.js";
import type { IStaffAccountProvisioner } from "./ports/IStaffAccountProvisioner.js";
import type { IStaffInviteRepository, StaffInvite } from "./ports/IStaffInviteRepository.js";

export interface CompleteStaffInviteInput {
  token: string;
  password: string;
}

export interface CompleteStaffInviteOutput {
  userId: string;
  email: string;
}

/**
 * Turns a pending invite into a real account. Not wrapped in one DB
 * transaction — the account is provisioned through Better Auth's own
 * connection, separate from the one `staffInviteRepository`/`auditLogRepository`
 * write through, so a crash between `provision` and `markCompleted` is a real,
 * accepted gap. `apps/api/src/scripts/seed-admin.ts` already lives with the
 * exact same two-step, non-atomic shape for the same reason.
 *
 * A `teacher` invite also writes `teachers.user_id` (OOC-79). The file is
 * re-checked before the account is opened — it may have left the roster since
 * the invite went out — and the link itself only lands on a file still without
 * an account. With one open invite per file (`staff_invites_pending_teacher_uidx`)
 * nothing else writes that column, so a refused link is not expected; if it
 * happens the account stays, unlinked, and the audit entry says so — the team
 * screen shows a teacher account without a file as a finding.
 */
export class CompleteStaffInviteUseCase extends BaseUseCase<CompleteStaffInviteInput, CompleteStaffInviteOutput> {
  constructor(
    private readonly staffInviteRepository: IStaffInviteRepository,
    private readonly staffAccountProvisioner: IStaffAccountProvisioner,
    private readonly teacherRepository: ITeacherRepository,
    private readonly auditLogRepository: IAuditLogRepository,
  ) {
    super();
  }

  async run(input: CompleteStaffInviteInput): Promise<CompleteStaffInviteOutput> {
    const invite = await this.staffInviteRepository.findByToken(input.token);
    if (!invite) {
      throw new NotFoundError({
        reason: "staff_invite.not_found",
        message: "No invite with this token.",
      });
    }
    if (invite.status !== "pending") {
      throw new UnableToProcessEntryError({
        reason: "staff_invite.not_pending",
        message: `Invite is ${invite.status}, not pending.`,
      });
    }
    if (invite.expiresAt.getTime() < Date.now()) {
      throw new UnableToProcessEntryError({
        reason: "staff_invite.expired",
        message: "Invite has expired.",
      });
    }

    const teacherId = await this.linkableTeacherId(invite);

    const { userId } = await this.staffAccountProvisioner.provision({
      email: invite.email,
      name: `${invite.firstName} ${invite.lastName}`.trim(),
      password: input.password,
      role: invite.role,
    });

    const teacherLinked = teacherId ? await this.teacherRepository.linkAccount(teacherId, userId) : null;

    await this.staffInviteRepository.markCompleted(invite.id, userId);

    await this.auditLogRepository.append({
      actorId: userId,
      action: "staff.invite_completed",
      targetId: userId,
      metadata: teacherId ? { role: invite.role, teacherId, teacherLinked } : { role: invite.role },
      at: new Date(),
    });

    return { userId, email: invite.email };
  }

  private async linkableTeacherId(invite: StaffInvite): Promise<string | null> {
    if (invite.role !== "teacher") return null;
    if (!invite.teacherId) throw new TeacherInviteRefusedError({ reason: "staff_invite.teacher_required" });

    const teacher = await this.teacherRepository.findById(invite.teacherId);
    if (!teacher) throw new TeacherInviteRefusedError({ reason: "staff_invite.teacher_not_found" });
    if (!teacher.isActive) throw new TeacherInviteRefusedError({ reason: "staff_invite.teacher_inactive" });
    if (teacher.userId) throw new TeacherInviteRefusedError({ reason: "staff_invite.teacher_has_account" });

    return teacher.id;
  }
}
