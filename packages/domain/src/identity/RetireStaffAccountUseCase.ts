import { NotFoundError } from "../shared/base/errors/NotFoundError.js";
import { BaseUseCase } from "../shared/base/BaseUseCase.js";
import {
  CannotActOnSelfError,
  InsufficientPrivilegeError,
  StaffAccountConfirmationMismatchError,
  StaffAccountTeacherLinkedError,
} from "./errors.js";
import type { IAuditLogRepository } from "./ports/IAuditLogRepository.js";
import type { IStaffAccessRepository } from "./ports/IStaffAccessRepository.js";
import type { Role } from "./Role.js";

export interface RetireStaffAccountInput {
  actorId: string;
  actorRole: Role;
  targetUserId: string;
  /** The target's e-mail as the actor typed it, the confirmation itself. */
  confirmEmail: string;
}

/** Never deliverable (RFC 2606), and unique because the account id is. */
export function retiredStaffEmail(userId: string): string {
  return `retired-${userId}@retired.invalid`;
}

/**
 * "Eliminar perfil" (OOC-136). The row survives, because payments, contracts and
 * the audit trail point at it, and the account leaves the team, loses every
 * session and gives its e-mail back, so the same person can be invited again.
 * There is no way back from the panel.
 *
 * The confirmation is checked here too: the screen only guards against a slip,
 * and this is the rule.
 */
export class RetireStaffAccountUseCase extends BaseUseCase<RetireStaffAccountInput, void> {
  constructor(
    private readonly staffAccessRepository: IStaffAccessRepository,
    private readonly auditLogRepository: IAuditLogRepository,
  ) {
    super();
  }

  async run(input: RetireStaffAccountInput): Promise<void> {
    if (input.actorId === input.targetUserId) {
      throw new CannotActOnSelfError();
    }

    const target = await this.staffAccessRepository.findRetirable(input.targetUserId);
    if (!target) {
      throw new NotFoundError({
        reason: "staff_account.not_found",
        message: "No panel account with this id.",
      });
    }

    if (input.confirmEmail.trim().toLowerCase() !== target.email.trim().toLowerCase()) {
      throw new StaffAccountConfirmationMismatchError();
    }

    // Retiring discards the e-mail, so an admin cannot do it to a platform owner.
    if (target.role === "master" && input.actorRole !== "master") {
      throw new InsufficientPrivilegeError();
    }

    // The teacher file would keep pointing at a closed account: the cargo leaves
    // through the roster (OOC-79).
    if (target.hasTeacherFile) {
      throw new StaffAccountTeacherLinkedError();
    }

    const retired = await this.staffAccessRepository.retire(
      input.targetUserId,
      retiredStaffEmail(input.targetUserId),
    );
    if (!retired) {
      // Another admin got here first.
      throw new NotFoundError({
        reason: "staff_account.not_found",
        message: "No panel account with this id.",
      });
    }

    // Names only, never the e-mail (CLAUDE.md §8).
    await this.auditLogRepository.append({
      actorId: input.actorId,
      action: "staff.account_retired",
      targetId: input.targetUserId,
      metadata: { role: target.role },
      at: new Date(),
    });
  }
}
