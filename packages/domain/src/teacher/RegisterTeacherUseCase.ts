import type { IAuditLogRepository } from "../identity/ports/IAuditLogRepository.js";
import { BaseUseCase } from "../shared/base/BaseUseCase.js";
import { TeacherAlreadyRegisteredError } from "./errors.js";
import { Teacher, type CreateTeacherDTO, type PendingTeacherDataDTO } from "./Teacher.js";
import type { ITeacherRepository } from "./TeacherRepository.js";

export type RegisterTeacherInput =
  | { actorId: string; teacher: CreateTeacherDTO; onboarding?: false }
  /** Name, e-mail and languages only: the teacher completes the rest (OOC-103). */
  | { actorId: string; teacher: PendingTeacherDataDTO; onboarding: true };

/**
 * Registers a teacher on the roster (OOC-78). Creates the file only — the
 * panel account is a separate staff invite, and the contract is filed on its
 * own step (OOC-81).
 */
export class RegisterTeacherUseCase extends BaseUseCase<RegisterTeacherInput, Teacher> {
  constructor(
    private readonly teachers: ITeacherRepository,
    private readonly auditLog: IAuditLogRepository,
  ) {
    super();
  }

  async run(input: RegisterTeacherInput): Promise<Teacher> {
    const teacher = input.onboarding ? Teacher.createPending(input.teacher) : Teacher.create(input.teacher);

    // A pending file has no document yet — the check runs at onboarding.
    if (teacher.nationalIdType !== null && teacher.nationalId !== null) {
      const alreadyOnFile = await this.teachers.findByNationalId({
        nationalIdType: teacher.nationalIdType,
        nationalId: teacher.nationalId,
      });
      if (alreadyOnFile) throw new TeacherAlreadyRegisteredError();
    }

    const created = await this.teachers.create(teacher);

    await this.auditLog.append({
      actorId: input.actorId,
      action: "teacher.registered",
      targetId: created.id,
      metadata: { onboarding: input.onboarding === true },
      at: created.createdAt,
    });

    return created;
  }
}
