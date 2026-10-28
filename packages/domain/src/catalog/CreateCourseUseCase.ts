import { BaseUseCase } from "../shared/base/BaseUseCase.js";
import type { IAuditLogRepository } from "../identity/ports/IAuditLogRepository.js";
import { Course, type CreateCourseDTO } from "./Course.js";
import type { ICourseRepository } from "./ports/ICourseRepository.js";
import { LandingKeyTakenError, LanguageNotFoundError } from "./errors.js";
import type { ILanguageRepository } from "./ports/ILanguageRepository.js";

export interface CreateCourseInput {
  actorId: string;
  /** The language comes as a Language id; its name is filled in here (OOC-128). */
  course: Omit<CreateCourseDTO, "language" | "languageId"> & { languageId: string };
}

/**
 * Opens a course (OOC-36). It is on the shelf the moment this returns: the
 * class group form reads live courses, so the next screen can open a class
 * group on it — that is the whole acceptance criterion.
 */
export class CreateCourseUseCase extends BaseUseCase<CreateCourseInput, Course> {
  constructor(
    private readonly courses: ICourseRepository,
    private readonly languages: ILanguageRepository,
    private readonly auditLog: IAuditLogRepository,
  ) {
    super();
  }

  async run(input: CreateCourseInput): Promise<Course> {
    const language = await this.languages.findById(input.course.languageId);
    if (!language || language.isDeleted) throw new LanguageNotFoundError();

    const course = Course.create({ ...input.course, language: language.name });
    if (course.landingKey && (await this.courses.findLiveByLandingKey(course.landingKey))) {
      throw new LandingKeyTakenError();
    }

    const created = await this.courses.create(course);

    await this.auditLog.append({
      actorId: input.actorId,
      action: "catalog.course.created",
      targetId: created.id,
      metadata: { name: created.name, language: created.language },
      at: created.createdAt,
    });

    return created;
  }
}
