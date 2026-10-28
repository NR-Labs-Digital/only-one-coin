import { BaseUseCase } from "../shared/base/BaseUseCase.js";
import type { IAuditLogRepository } from "../identity/ports/IAuditLogRepository.js";
import { LanguageInUseError, LanguageNotFoundError } from "./errors.js";
import type { ILanguageRepository } from "./ports/ILanguageRepository.js";

export interface RetireLanguageInput {
  actorId: string;
  id: string;
}

/**
 * Takes a language off the list. Refused while a live course is still filed
 * under it — unlike retiring a course, which only warns: a course left without
 * a language would vanish from the checkout's grouping and from the teacher
 * picker. The courses move first, from their own settings. Teachers who held
 * it let go of it; the answer says how many.
 */
export class RetireLanguageUseCase extends BaseUseCase<RetireLanguageInput, { teachersReleased: number }> {
  constructor(
    private readonly languages: ILanguageRepository,
    private readonly auditLog: IAuditLogRepository,
  ) {
    super();
  }

  async run(input: RetireLanguageInput): Promise<{ teachersReleased: number }> {
    const language = await this.languages.findById(input.id);
    if (!language || language.isDeleted) throw new LanguageNotFoundError();
    if ((await this.languages.countLiveCourses(language.id)) > 0) throw new LanguageInUseError();

    language.softDelete();
    const teachersReleased = await this.languages.retire(language);
    await this.auditLog.append({
      actorId: input.actorId,
      action: "catalog.language.retired",
      targetId: language.id,
      metadata: { name: language.name, teachersReleased },
      at: language.deletedAt ?? new Date(),
    });
    return { teachersReleased };
  }
}
