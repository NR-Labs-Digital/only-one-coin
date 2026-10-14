import { BaseUseCase } from "../shared/base/BaseUseCase.js";
import type { IAuditLogRepository } from "../identity/ports/IAuditLogRepository.js";
import type { Course, UpdateCourseDTO } from "./Course.js";
import { CourseNotFoundError, LandingKeyTakenError } from "./errors.js";
import type { ICourseRepository } from "./ports/ICourseRepository.js";

export interface UpdateCourseInput {
  actorId: string;
  id: string;
  patch: UpdateCourseDTO;
}

/**
 * Changes a course from here on. Class groups already running keep the rule
 * their students enrolled under — the same reasoning that freezes the price
 * at enrollment. Which fields a caller may send is the route's business (two
 * routes, two role sets); this usecase only applies and audits.
 */
export class UpdateCourseUseCase extends BaseUseCase<UpdateCourseInput, Course> {
  constructor(
    private readonly courses: ICourseRepository,
    private readonly auditLog: IAuditLogRepository,
  ) {
    super();
  }

  async run(input: UpdateCourseInput): Promise<Course> {
    const course = await this.courses.findById(input.id);
    if (!course) throw new CourseNotFoundError();

    const changed = course.update(input.patch);
    if (changed.length === 0) return course;

    if (changed.includes("landingKey") && course.landingKey) {
      const holder = await this.courses.findLiveByLandingKey(course.landingKey);
      if (holder && holder.id !== course.id) throw new LandingKeyTakenError();
    }

    const saved = await this.courses.update(course);

    await this.auditLog.append({
      actorId: input.actorId,
      action: "catalog.course.updated",
      targetId: course.id,
      metadata: { fields: changed },
      at: saved.updatedAt,
    });

    return saved;
  }
}
