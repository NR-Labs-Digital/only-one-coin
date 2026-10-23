import type { IAuditLogRepository } from "../identity/ports/IAuditLogRepository.js";
import { BaseUseCase } from "../shared/base/BaseUseCase.js";
import { TeacherAlreadyRegisteredError, TeacherNotFoundError } from "./errors.js";
import type { Teacher, TeacherDataDTO } from "./Teacher.js";
import type { ITeacherRepository } from "./TeacherRepository.js";

export interface UpdateTeacherInput {
  actorId: string;
  teacherId: string;
  /** The whole file minus the week, as the form holds it. */
  teacher: TeacherDataDTO;
}

/**
 * A staff correction to the teacher file (OOC-78). A document that moves onto
 * another teacher's file is refused, and the audit line names the fields that
 * changed, never their values (CLAUDE.md §8).
 */
export class UpdateTeacherUseCase extends BaseUseCase<UpdateTeacherInput, Teacher> {
  constructor(
    private readonly teachers: ITeacherRepository,
    private readonly auditLog: IAuditLogRepository,
  ) {
    super();
  }

  async run(input: UpdateTeacherInput): Promise<Teacher> {
    const teacher = await this.teachers.findById(input.teacherId);
    if (!teacher) throw new TeacherNotFoundError();

    const changed = teacher.rewrite(input.teacher);
    if (changed.length === 0) return teacher;

    if (changed.includes("nationalIdType") || changed.includes("nationalId")) {
      const holder = await this.teachers.findByNationalId({
        nationalIdType: teacher.nationalIdType,
        nationalId: teacher.nationalId,
      });
      if (holder && holder.id !== teacher.id) throw new TeacherAlreadyRegisteredError();
    }

    const saved = await this.teachers.update(teacher);

    await this.auditLog.append({
      actorId: input.actorId,
      action: "teacher.updated",
      targetId: teacher.id,
      metadata: { fields: changed },
      at: saved.updatedAt,
    });

    return saved;
  }
}
