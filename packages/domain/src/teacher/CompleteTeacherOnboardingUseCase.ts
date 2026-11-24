import type { IAuditLogRepository } from "../identity/ports/IAuditLogRepository.js";
import { BaseUseCase } from "../shared/base/BaseUseCase.js";
import { TeacherAlreadyRegisteredError, TeacherNotFoundError } from "./errors.js";
import type { Teacher, TeacherOnboardingDTO } from "./Teacher.js";
import type { ITeacherRepository } from "./TeacherRepository.js";

export interface CompleteTeacherOnboardingInput {
  /** The session's account — the file is the one linked to it, never an id from the client. */
  userId: string;
  data: TeacherOnboardingDTO;
}

/**
 * The teacher fills in their own file, once, after accepting the invite
 * (OOC-103). The file is resolved from the session (`teachers.user_id`,
 * OOC-79): an account with no file has nothing to complete (404). A complete
 * file refuses (422 `teacher.onboarding_closed`) — from then on it is
 * coordination's to correct. A document already on another file is refused as
 * at registration. The audit line names the fields, never the values (§8).
 */
export class CompleteTeacherOnboardingUseCase extends BaseUseCase<CompleteTeacherOnboardingInput, Teacher> {
  constructor(
    private readonly teachers: ITeacherRepository,
    private readonly auditLog: IAuditLogRepository,
  ) {
    super();
  }

  async run(input: CompleteTeacherOnboardingInput): Promise<Teacher> {
    const teacher = await this.teachers.findByUserId(input.userId);
    if (!teacher) throw new TeacherNotFoundError();

    const fields = teacher.completeOnboarding(input.data);

    const holder = await this.teachers.findByNationalId({
      nationalIdType: teacher.nationalIdType!,
      nationalId: teacher.nationalId!,
    });
    if (holder && holder.id !== teacher.id) throw new TeacherAlreadyRegisteredError();

    // Conditional on the file still being pending: two tabs sending at once
    // write once, and the second answers `onboarding_closed`.
    const saved = await this.teachers.completeOnboarding(teacher);

    await this.auditLog.append({
      actorId: input.userId,
      action: "teacher.onboarding_completed",
      targetId: teacher.id,
      metadata: { fields },
      at: saved.updatedAt,
    });

    return saved;
  }
}
