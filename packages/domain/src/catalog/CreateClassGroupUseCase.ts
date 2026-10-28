import { BaseUseCase } from "../shared/base/BaseUseCase.js";
import type { IAuditLogRepository } from "../identity/ports/IAuditLogRepository.js";
import { ClassGroup, type CreateClassGroupDTO } from "./ClassGroup.js";
import { CourseNotFoundError, PeriodNotFoundError } from "./errors.js";
import type { IAcademicPeriodRepository } from "./ports/IAcademicPeriodRepository.js";
import type { IClassGroupRepository } from "./ports/IClassGroupRepository.js";
import type { ICourseRepository } from "./ports/ICourseRepository.js";
import type { ITeacherRepository } from "../teacher/TeacherRepository.js";
import { assertAssignableTeacher } from "./assignableTeacher.js";

export interface CreateClassGroupInput {
  actorId: string;
  classGroup: CreateClassGroupDTO;
  /** Open enrollment right away (draft → enrolling) — refused if incomplete. */
  publish: boolean;
}

export class CreateClassGroupUseCase extends BaseUseCase<CreateClassGroupInput, ClassGroup> {
  constructor(
    private readonly courses: ICourseRepository,
    private readonly periods: IAcademicPeriodRepository,
    private readonly classGroups: IClassGroupRepository,
    private readonly teachers: ITeacherRepository,
    private readonly auditLog: IAuditLogRepository,
  ) {
    super();
  }

  async run(input: CreateClassGroupInput): Promise<ClassGroup> {
    const course = await this.courses.findById(input.classGroup.courseId);
    if (!course || course.isDeleted) throw new CourseNotFoundError();

    const period = await this.periods.findById(input.classGroup.academicPeriodId);
    if (!period || period.isDeleted) throw new PeriodNotFoundError();

    const teacherId = input.classGroup.teacherId ?? null;
    if (teacherId !== null) await assertAssignableTeacher(this.teachers, teacherId, course.language);

    const [code] = await this.classGroups.nextCodes(1);
    const group = ClassGroup.create(input.classGroup, code!);
    if (input.publish) group.advanceTo("enrolling");

    const created = await this.classGroups.create(group);

    await this.auditLog.append({
      actorId: input.actorId,
      action: "catalog.class_group.created",
      targetId: created.id,
      metadata: { courseId: course.id, academicPeriodId: period.id, status: created.status, teacherId },
      at: created.createdAt,
    });

    return created;
  }
}
