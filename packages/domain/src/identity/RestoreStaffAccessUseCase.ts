import { BaseUseCase } from "../shared/base/BaseUseCase.js";
import type { ITeacherRepository } from "../teacher/TeacherRepository.js";
import { CannotActOnSelfError, TeacherOffRosterAccessError } from "./errors.js";
import type { IAuditLogRepository } from "./ports/IAuditLogRepository.js";
import type { IStaffAccessRepository } from "./ports/IStaffAccessRepository.js";

export interface RestoreStaffAccessInput {
  actorId: string;
  targetUserId: string;
}

/**
 * The account of a teacher off the roster stays closed (OOC-78): leaving the
 * roster closed it, and only rejoining reopens it (OOC-79).
 */
export class RestoreStaffAccessUseCase extends BaseUseCase<RestoreStaffAccessInput, void> {
  constructor(
    private readonly staffAccessRepository: IStaffAccessRepository,
    private readonly teacherRepository: ITeacherRepository,
    private readonly auditLogRepository: IAuditLogRepository,
  ) {
    super();
  }

  async run(input: RestoreStaffAccessInput): Promise<void> {
    if (input.actorId === input.targetUserId) {
      throw new CannotActOnSelfError();
    }

    const teacher = await this.teacherRepository.findByUserId(input.targetUserId);
    if (teacher && !teacher.isActive) {
      throw new TeacherOffRosterAccessError();
    }

    await this.staffAccessRepository.unban(input.targetUserId);

    await this.auditLogRepository.append({
      actorId: input.actorId,
      action: "staff.access_restored",
      targetId: input.targetUserId,
      metadata: {},
      at: new Date(),
    });
  }
}
