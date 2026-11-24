import { randomBytes } from "node:crypto";
import { BaseUseCase } from "../shared/base/BaseUseCase.js";
import { UnableToProcessEntryError } from "../shared/base/errors/UnableToProcessEntryError.js";
import type { ITeacherRepository } from "../teacher/TeacherRepository.js";
import { TeacherInviteRefusedError } from "./errors.js";
import type { IAuditLogRepository } from "./ports/IAuditLogRepository.js";
import type { IStaffInviteRepository, StaffInvite } from "./ports/IStaffInviteRepository.js";
import type { IStaffInviteLinkBuilder } from "./ports/IStaffInviteLinkBuilder.js";
import type { IStaffUserLookup } from "./ports/IStaffUserLookup.js";
import { DEFAULT_LOCALE, type EmailNotification } from "../notification/EmailNotification.js";
import type { Role } from "./Role.js";
import type { IStaffProfileRepository } from "./staffProfile/IStaffProfileRepository.js";
import { assertWithinActor } from "./staffProfile/StaffProfile.js";
import { cargoPermissions, comparablePermissions } from "./staffProfile/cargoPermissions.js";

const INVITE_TTL_DAYS = 7;

export interface CreateStaffInviteInput {
  actorId: string;
  email: string;
  firstName: string;
  lastName: string;
  role: Role;
  /** The teacher file a `teacher` invite opens an account for — required for that cargo, ignored for any other. */
  teacherId?: string | null;
  /** The cargo created in Equipo a `custom` invite opens the account on (OOC-183). */
  profileId?: string | null;
  /** What the acting account's own cargo lets it do: nobody invites into more (CLAUDE.md §8). */
  actorPermissions: ReadonlySet<string>;
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
    private readonly linkBuilder: IStaffInviteLinkBuilder,
    private readonly staffProfiles: IStaffProfileRepository,
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
    const profileId = input.role === "custom" ? (input.profileId ?? null) : null;

    // Anti-escalation (OOC-183): the cargo the invite opens holds nothing the
    // actor does not. `cargoPermissions` also refuses a `custom` invite whose
    // cargo is missing or retired.
    assertWithinActor(
      input.actorPermissions,
      comparablePermissions(await cargoPermissions(this.staffProfiles, { role: input.role, profileId })),
    );

    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + INVITE_TTL_DAYS);

    const invite = await this.staffInviteRepository.create(
      {
        email,
        firstName: input.firstName.trim(),
        lastName: input.lastName.trim(),
        role: input.role,
        token,
        invitedBy: input.actorId,
        teacherId,
        profileId,
        expiresAt,
      },
      // Spanish, like a manual enrollment's e-mail: the invite does not record
      // the language the person reads, only the one the admin was using.
      (created): EmailNotification[] => [
        {
          templateKey: "staff_invite",
          to: created.email,
          locale: DEFAULT_LOCALE,
          vars: {
            recipientName: `${created.firstName} ${created.lastName}`,
            accessUrl: this.linkBuilder.build(created.token, DEFAULT_LOCALE, input.role),
          },
          dedupeKey: `staff_invite:${created.id}:staff`,
        },
      ],
    );

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
        ...(profileId ? { profileId } : {}),
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
