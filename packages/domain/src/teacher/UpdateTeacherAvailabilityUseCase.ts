import type { WeeklySlot } from "../catalog/ClassGroup.js";
import type { IAuditLogRepository } from "../identity/ports/IAuditLogRepository.js";
import { BaseUseCase } from "../shared/base/BaseUseCase.js";
import { TeacherNotFoundError } from "./errors.js";
import type { Teacher } from "./Teacher.js";
import type { ITeacherRepository } from "./TeacherRepository.js";

export interface UpdateTeacherAvailabilityInput {
  actorId: string;
  teacherId: string;
  availability: WeeklySlot[];
}

/**
 * Replaces the teacher's weekly windows (OOC-78). The class groups already on
 * them are not touched: availability is declared, allocation is decided, and
 * when the two disagree the file shows it rather than fixing either.
 */
export class UpdateTeacherAvailabilityUseCase extends BaseUseCase<UpdateTeacherAvailabilityInput, Teacher> {
  constructor(
    private readonly teachers: ITeacherRepository,
    private readonly auditLog: IAuditLogRepository,
  ) {
    super();
  }

  async run(input: UpdateTeacherAvailabilityInput): Promise<Teacher> {
    const teacher = await this.teachers.findById(input.teacherId);
    if (!teacher) throw new TeacherNotFoundError();

    if (!teacher.replaceAvailability(input.availability)) return teacher;

    const saved = await this.teachers.update(teacher);

    await this.auditLog.append({
      actorId: input.actorId,
      action: "teacher.availability_updated",
      targetId: teacher.id,
      metadata: { windows: saved.availability.length },
      at: saved.updatedAt,
    });

    return saved;
  }
}
