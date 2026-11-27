import type { IAuditLogRepository } from "../identity/ports/IAuditLogRepository.js";
import type { IPlatformSettingsRepository } from "../platform/ports/IPlatformSettingsRepository.js";
import { BaseUseCase } from "../shared/base/BaseUseCase.js";
import {
  ClassroomAccountTeacherInactiveError,
  TeacherAlreadyRegisteredError,
  TeacherNotFoundError,
} from "./errors.js";
import type { PendingTeacherDataDTO, Teacher, TeacherDataDTO } from "./Teacher.js";
import type { ITeacherRepository } from "./TeacherRepository.js";

export interface UpdateTeacherInput {
  actorId: string;
  teacherId: string;
  /** The whole file minus the week, as the form holds it — or, on a file still pending onboarding, without the profile (OOC-103). */
  teacher: TeacherDataDTO | PendingTeacherDataDTO;
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
    private readonly settings: IPlatformSettingsRepository,
  ) {
    super();
  }

  async run(input: UpdateTeacherInput): Promise<Teacher> {
    const teacher = await this.teachers.findById(input.teacherId);
    if (!teacher) throw new TeacherNotFoundError();

    const changed = teacher.rewrite(input.teacher);
    if (changed.length === 0) return teacher;

    if (
      (changed.includes("nationalIdType") || changed.includes("nationalId")) &&
      teacher.nationalIdType !== null &&
      teacher.nationalId !== null
    ) {
      const holder = await this.teachers.findByNationalId({
        nationalIdType: teacher.nationalIdType,
        nationalId: teacher.nationalId,
      });
      if (holder && holder.id !== teacher.id) throw new TeacherAlreadyRegisteredError();
    }

    // Off the roster, the file holds no Classroom account (leaving clears it, OOC-196).
    if (changed.includes("classroomAccountId") && teacher.classroomAccountId !== null && !teacher.isActive) {
      throw new ClassroomAccountTeacherInactiveError();
    }
    const classroom = changed.includes("classroomAccountId")
      ? { maxTeachers: (await this.settings.get()).classroomAccountMaxTeachers }
      : undefined;

    const saved = await this.teachers.update(teacher, classroom);

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
