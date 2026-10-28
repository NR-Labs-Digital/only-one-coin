import { BaseUseCase } from "../shared/base/BaseUseCase.js";
import type { IAuditLogRepository } from "../identity/ports/IAuditLogRepository.js";
import { Language } from "./Language.js";
import type { ILanguageRepository } from "./ports/ILanguageRepository.js";

export interface CreateLanguageInput {
  actorId: string;
  name: string;
}

/** Opens a language. "inglés" next to a live "Inglés" is refused, not a second English. */
export class CreateLanguageUseCase extends BaseUseCase<CreateLanguageInput, Language> {
  constructor(
    private readonly languages: ILanguageRepository,
    private readonly auditLog: IAuditLogRepository,
  ) {
    super();
  }

  async run(input: CreateLanguageInput): Promise<Language> {
    const language = Language.create(input.name);
    await this.languages.create(language);
    await this.auditLog.append({
      actorId: input.actorId,
      action: "catalog.language.created",
      targetId: language.id,
      metadata: { name: language.name },
      at: language.createdAt,
    });
    return language;
  }
}
