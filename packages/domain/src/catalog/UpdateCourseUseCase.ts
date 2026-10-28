import { BaseUseCase } from "../shared/base/BaseUseCase.js";
import type { IAuditLogRepository } from "../identity/ports/IAuditLogRepository.js";
import type { Course, UpdateCourseDTO } from "./Course.js";
import { CourseNotFoundError, LandingKeyTakenError, LanguageNotFoundError } from "./errors.js";
import type { ILanguageRepository } from "./ports/ILanguageRepository.js";
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
    private readonly languages: ILanguageRepository,
    private readonly auditLog: IAuditLogRepository,
  ) {
    super();
  }

  async run(input: UpdateCourseInput): Promise<Course> {
    const course = await this.courses.findById(input.id);
    if (!course) throw new CourseNotFoundError();

    // The language moves only by id (OOC-128); the text is the language's own
    // name, never what the caller typed.
    const patch: UpdateCourseDTO = { ...input.patch };
    delete patch.language;
    if (patch.languageId !== undefined && patch.languageId !== course.languageId) {
      const language = await this.languages.findById(patch.languageId);
      if (!language || language.isDeleted) throw new LanguageNotFoundError();
      patch.language = language.name;
    }

    const changed = course.update(patch);
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
