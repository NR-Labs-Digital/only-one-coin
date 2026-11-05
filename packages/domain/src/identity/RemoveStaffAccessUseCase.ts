import { BaseUseCase } from "../shared/base/BaseUseCase.js";
import { NotFoundError } from "../shared/base/errors/NotFoundError.js";
import { CannotActOnSelfError } from "./errors.js";
import type { IAuditLogRepository } from "./ports/IAuditLogRepository.js";
import type { IStaffAccessRepository } from "./ports/IStaffAccessRepository.js";

export interface RemoveStaffAccessInput {
  actorId: string;
  targetUserId: string;
}

/** "Quitar acceso" — the account survives, only the door closes (CLAUDE.md §8). */
export class RemoveStaffAccessUseCase extends BaseUseCase<RemoveStaffAccessInput, void> {
  constructor(
    private readonly staffAccessRepository: IStaffAccessRepository,
    private readonly auditLogRepository: IAuditLogRepository,
  ) {
    super();
  }

  async run(input: RemoveStaffAccessInput): Promise<void> {
    if (input.actorId === input.targetUserId) {
      throw new CannotActOnSelfError();
    }

    const banned = await this.staffAccessRepository.ban(input.targetUserId, "backoffice_access_removed");
    if (!banned) {
      throw new NotFoundError({
        reason: "staff_account.not_found",
        message: "No panel account with this id.",
      });
    }

    await this.auditLogRepository.append({
      actorId: input.actorId,
      action: "staff.access_removed",
      targetId: input.targetUserId,
      metadata: {},
      at: new Date(),
    });
  }
}
