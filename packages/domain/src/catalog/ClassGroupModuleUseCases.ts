import { BaseUseCase } from "../shared/base/BaseUseCase.js";
import type { IAuditLogRepository } from "../identity/ports/IAuditLogRepository.js";
import type { ITeacherRepository } from "../teacher/TeacherRepository.js";
import { assertAssignableTeacher } from "./assignableTeacher.js";
import type { ClassGroup } from "./ClassGroup.js";
import type { ClassGroupModule, CreateClassGroupModuleDTO, UpdateClassGroupModuleDTO } from "./ClassGroupModule.js";
import { assertClassroomLinksOfCourse, assertModuleOfCourse } from "./classGroupTeaching.js";
import { CatalogClassGroupNotFoundError, CourseNotFoundError } from "./errors.js";
import type { IClassGroupRepository } from "./ports/IClassGroupRepository.js";
import type { ICourseRepository } from "./ports/ICourseRepository.js";
import type { Course } from "./Course.js";

/**
 * The module runs of a class group — the "sub-turmas" (OOC-156): opening
 * another run beside the ones already going on, editing one, retiring one.
 * Who may is the route's role list — the same people who edit a class group.
 */

async function liveClassGroup(classGroups: IClassGroupRepository, id: string): Promise<ClassGroup> {
  const group = await classGroups.findById(id);
  if (!group || group.isDeleted) throw new CatalogClassGroupNotFoundError();
  return group;
}

async function courseOf(courses: ICourseRepository, group: ClassGroup): Promise<Course> {
  const course = await courses.findById(group.courseId);
  if (!course) throw new CourseNotFoundError();
  return course;
}

export interface AddClassGroupModuleInput {
  actorId: string;
  classGroupId: string;
  module: CreateClassGroupModuleDTO;
}

/**
 * Opens another module run in a class group: a module of its course, at most
 * one run per module, its own schedule, teacher and Classroom. Students reach
 * it by the staff moving them (OOC-84) or, later, by progression — a new
 * student always starts in the first run.
 */
export class AddClassGroupModuleUseCase extends BaseUseCase<AddClassGroupModuleInput, ClassGroupModule> {
  constructor(
    private readonly courses: ICourseRepository,
    private readonly classGroups: IClassGroupRepository,
    private readonly teachers: ITeacherRepository,
    private readonly auditLog: IAuditLogRepository,
  ) {
    super();
  }

  async run(input: AddClassGroupModuleInput): Promise<ClassGroupModule> {
    const group = await liveClassGroup(this.classGroups, input.classGroupId);
    const course = await courseOf(this.courses, group);

    assertModuleOfCourse(input.module.fullCourse ? null : (input.module.module ?? null), course.modules);
    assertClassroomLinksOfCourse(input.module.classroomLinks, course.modules);
    const teacherId = input.module.teacherId ?? null;
    if (teacherId !== null) await assertAssignableTeacher(this.teachers, teacherId, course.language);

    const run = group.addModule(input.module);
    const saved = await this.classGroups.insertModule(run);

    await this.auditLog.append({
      actorId: input.actorId,
      action: "catalog.class_group.module_added",
      targetId: group.id,
      metadata: { classGroupModuleId: saved.id, module: saved.module, fullCourse: saved.fullCourse, teacherId },
      at: saved.createdAt,
    });
    return saved;
  }
}

export interface UpdateClassGroupModuleInput {
  actorId: string;
  classGroupId: string;
  classGroupModuleId: string;
  patch: UpdateClassGroupModuleDTO;
}

/**
 * Edits one run. A new module must be one of the course's and not run twice;
 * a new teacher goes through the roster check (OOC-80) — an untouched module
 * or allocation is never re-checked, so a course cut to fewer modules, or a
 * teacher who left the roster mid-cycle, never locks the run.
 */
export class UpdateClassGroupModuleUseCase extends BaseUseCase<UpdateClassGroupModuleInput, ClassGroupModule> {
  constructor(
    private readonly courses: ICourseRepository,
    private readonly classGroups: IClassGroupRepository,
    private readonly teachers: ITeacherRepository,
    private readonly auditLog: IAuditLogRepository,
  ) {
    super();
  }

  async run(input: UpdateClassGroupModuleInput): Promise<ClassGroupModule> {
    const group = await liveClassGroup(this.classGroups, input.classGroupId);
    const run = group.moduleById(input.classGroupModuleId);
    const { patch } = input;

    // The same resolution as `ClassGroupModule.update`: picking a module ends
    // "full course", and the reverse.
    const nextFullCourse = patch.fullCourse ?? (patch.module ? false : run.fullCourse);
    const nextModule = nextFullCourse ? null : patch.module !== undefined ? patch.module : run.module;
    const moduleChanges = nextFullCourse !== run.fullCourse || nextModule !== run.module;
    const teacherChanges = patch.teacherId !== undefined && patch.teacherId !== run.teacherId;
    if (moduleChanges) group.assertRunCanTeach(run.id, nextModule);
    if (moduleChanges || teacherChanges || patch.classroomLinks?.length) {
      const course = await courseOf(this.courses, group);
      if (moduleChanges) assertModuleOfCourse(nextModule, course.modules);
      assertClassroomLinksOfCourse(patch.classroomLinks, course.modules);
      if (teacherChanges && patch.teacherId) await assertAssignableTeacher(this.teachers, patch.teacherId, course.language);
    }

    const changed = run.update(patch);
    if (changed.length === 0) return run;
    group.assertModulesConsistent();

    const saved = await this.classGroups.updateModule(run);

    await this.auditLog.append({
      actorId: input.actorId,
      action: "catalog.class_group.module_updated",
      targetId: group.id,
      metadata: {
        classGroupModuleId: run.id,
        fields: changed,
        ...(changed.includes("teacherId") && { teacherId: run.teacherId }),
      },
      at: saved.updatedAt,
    });
    return saved;
  }
}

export interface RetireClassGroupModuleInput {
  actorId: string;
  classGroupId: string;
  classGroupModuleId: string;
}

/**
 * Retires a run opened by mistake or no longer needed. Never the class
 * group's last one, and never one students are still in — the repository's
 * write re-checks that, because a seat can land in it meanwhile. Retired, not
 * deleted: grades and history keep pointing at it.
 */
export class RetireClassGroupModuleUseCase extends BaseUseCase<RetireClassGroupModuleInput, void> {
  constructor(
    private readonly classGroups: IClassGroupRepository,
    private readonly auditLog: IAuditLogRepository,
  ) {
    super();
  }

  async run(input: RetireClassGroupModuleInput): Promise<void> {
    const group = await liveClassGroup(this.classGroups, input.classGroupId);
    const run = group.retireModule(input.classGroupModuleId);
    await this.classGroups.retireModule(run);

    await this.auditLog.append({
      actorId: input.actorId,
      action: "catalog.class_group.module_retired",
      targetId: group.id,
      metadata: { classGroupModuleId: run.id, module: run.module },
      at: run.deletedAt ?? new Date(),
    });
  }
}
