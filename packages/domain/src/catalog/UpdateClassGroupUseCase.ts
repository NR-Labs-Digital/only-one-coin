import { BaseUseCase } from "../shared/base/BaseUseCase.js";
import type { IAuditLogRepository } from "../identity/ports/IAuditLogRepository.js";
import { assertModuleOfCourse, type ClassGroup, type UpdateClassGroupDTO } from "./ClassGroup.js";
import { CatalogClassGroupNotFoundError, CourseNotFoundError } from "./errors.js";
import type { IClassGroupRepository } from "./ports/IClassGroupRepository.js";
import type { ICourseRepository } from "./ports/ICourseRepository.js";
import type { ITeacherRepository } from "../teacher/TeacherRepository.js";
import { assertAssignableTeacher } from "./assignableTeacher.js";

export interface UpdateClassGroupInput {
  actorId: string;
  id: string;
  patch: UpdateClassGroupDTO;
}

/**
 * Edits a class group. Capacity under the seats taken is refused by the
 * repository's conditional UPDATE, not here — the seats move under us.
 */
export class UpdateClassGroupUseCase extends BaseUseCase<UpdateClassGroupInput, ClassGroup> {
  constructor(
    private readonly courses: ICourseRepository,
    private readonly classGroups: IClassGroupRepository,
    private readonly teachers: ITeacherRepository,
    private readonly auditLog: IAuditLogRepository,
  ) {
    super();
  }

  async run(input: UpdateClassGroupInput): Promise<ClassGroup> {
    const group = await this.classGroups.findById(input.id);
    if (!group || group.isDeleted) throw new CatalogClassGroupNotFoundError();

    const courseChanges = input.patch.courseId !== undefined && input.patch.courseId !== group.courseId;
    const teacherChanges = input.patch.teacherId !== undefined && input.patch.teacherId !== group.teacherId;

    const moduleChanges = input.patch.module !== undefined && input.patch.module !== group.module;

    if (courseChanges) {
      const course = await this.courses.findById(input.patch.courseId!);
      if (!course || course.isDeleted) throw new CourseNotFoundError();
    }

    // A new module, or the same module carried onto another course, must be
    // one of that course's; an untouched one is never re-checked — a course
    // cut to fewer modules does not lock its class groups.
    const moduleNumber = input.patch.module !== undefined ? input.patch.module : group.module;
    if (moduleNumber !== null && (courseChanges || moduleChanges)) {
      const course = await this.courses.findById(input.patch.courseId ?? group.courseId);
      if (!course) throw new CourseNotFoundError();
      assertModuleOfCourse(moduleNumber, course.modules);
    }

    // A new allocation, or the same teacher carried onto another course,
    // goes through the roster check; an untouched allocation never does.
    const teacherId = input.patch.teacherId !== undefined ? input.patch.teacherId : group.teacherId;
    if (teacherId !== null && (courseChanges || teacherChanges)) {
      const course = await this.courses.findById(input.patch.courseId ?? group.courseId);
      if (!course) throw new CourseNotFoundError();
      await assertAssignableTeacher(this.teachers, teacherId, course.language);
    }

    const changed = group.update(input.patch);
    if (changed.length === 0) return group;

    const saved = await this.classGroups.update(group);

    await this.auditLog.append({
      actorId: input.actorId,
      action: "catalog.class_group.updated",
      targetId: group.id,
      metadata: { fields: changed, ...(changed.includes("teacherId") && { teacherId: group.teacherId }) },
      at: saved.updatedAt,
    });

    return saved;
  }
}
