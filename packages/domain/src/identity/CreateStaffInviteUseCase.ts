import { randomBytes } from "node:crypto";
import { BaseUseCase } from "../shared/base/BaseUseCase.js";
import { UnableToProcessEntryError } from "../shared/base/errors/UnableToProcessEntryError.js";
import type { ITeacherRepository } from "../teacher/TeacherRepository.js";
import { TeacherInviteRefusedError } from "./errors.js";
import type { IAuditLogRepository } from "./ports/IAuditLogRepository.js";
import type { IStaffInviteRepository, StaffInvite } from "./ports/IStaffInviteRepository.js";
import type { IStaffUserLookup } from "./ports/IStaffUserLookup.js";
import type { Role } from "./Role.js";

const INVITE_TTL_DAYS = 7;

export interface CreateStaffInviteInput {
  actorId: string;
  email: string;
  firstName: string;
  lastName: string;
  role: Role;
  /** The teacher file a `teacher` invite opens an account for — required for that cargo, ignored for any other. */
  teacherId?: string | null;
}

export interface CreateStaffInviteOutput {
  invite: StaffInvite;
}

/**
 * Opens a panel account, invite-link style (CLAUDE.md §8 — nobody but the
 * person invited ever holds a password). The token itself is generated here
 * with `node:crypto`, the same "plain Node builtin used directly in a
 * usecase" precedent `PromoteUserRoleUseCase` already sets with `new Date()`
 * — it is not delegating to any auth provider, just producing random bytes.
 *
 * A `teacher` invite names the teacher file the account will belong to
 * (OOC-79): a live file on the roster, with no account and no other open
 * invite. The partial unique index `staff_invites_pending_teacher_uidx` backs
 * the last check against two invites racing.
 */
export class CreateStaffInviteUseCase extends BaseUseCase<CreateStaffInviteInput, CreateStaffInviteOutput> {
  constructor(
    private readonly staffUserLookup: IStaffUserLookup,
    private readonly staffInviteRepository: IStaffInviteRepository,
    private readonly teacherRepository: ITeacherRepository,
    private readonly auditLogRepository: IAuditLogRepository,
  ) {
    super();
  }

  async run(input: CreateStaffInviteInput): Promise<CreateStaffInviteOutput> {
    const email = input.email.trim().toLowerCase();

    const alreadyStaff = await this.staffUserLookup.existsByEmail(email);
    if (alreadyStaff) {
      throw new UnableToProcessEntryError({
        reason: "staff_invite.email_taken",
        message: `An account with e-mail ${email} already exists.`,
      });
    }

    const pending = await this.staffInviteRepository.findPendingByEmail(email);
    if (pending) {
      throw new UnableToProcessEntryError({
        reason: "staff_invite.email_taken",
        message: `A pending invite for e-mail ${email} already exists.`,
      });
    }

    const teacherId = input.role === "teacher" ? await this.invitableTeacherId(input.teacherId ?? null) : null;

    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + INVITE_TTL_DAYS);

    const invite = await this.staffInviteRepository.create({
      email,
      firstName: input.firstName.trim(),
      lastName: input.lastName.trim(),
      role: input.role,
      token,
      invitedBy: input.actorId,
      teacherId,
      expiresAt,
    });

    await this.auditLogRepository.append({
      actorId: input.actorId,
      action: "staff.invite_created",
      targetId: invite.id,
      // firstName/lastName travel in metadata (not just email/role) so the
      // ledger can name the invitee — `targetId` here is the invite's own id,
      // not a "user".id, so the ledger query's join against "user" can't
      // resolve a display name for this entry the way it does for
      // `role.promote` (ListStaffRoleChangesQuery.ts).
      metadata: {
        email,
        role: input.role,
        firstName: invite.firstName,
        lastName: invite.lastName,
        ...(teacherId ? { teacherId } : {}),
      },
      at: new Date(),
    });

    return { invite };
  }

  private async invitableTeacherId(teacherId: string | null): Promise<string> {
    if (!teacherId) throw new TeacherInviteRefusedError({ reason: "staff_invite.teacher_required" });

    const teacher = await this.teacherRepository.findById(teacherId);
    if (!teacher) throw new TeacherInviteRefusedError({ reason: "staff_invite.teacher_not_found" });
    if (!teacher.isActive) throw new TeacherInviteRefusedError({ reason: "staff_invite.teacher_inactive" });
    if (teacher.userId) throw new TeacherInviteRefusedError({ reason: "staff_invite.teacher_has_account" });

    const open = await this.staffInviteRepository.findPendingByTeacherId(teacherId);
    if (open) throw new TeacherInviteRefusedError({ reason: "staff_invite.teacher_invite_pending" });

    return teacherId;
  }
}
