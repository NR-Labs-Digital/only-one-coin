import { BaseUseCase } from "../shared/base/BaseUseCase.js";
import type { IAuditLogRepository } from "../identity/ports/IAuditLogRepository.js";
import { LanguageNotFoundError } from "./errors.js";
import type { Language } from "./Language.js";
import type { ILanguageRepository } from "./ports/ILanguageRepository.js";

export interface RenameLanguageInput {
  actorId: string;
  id: string;
  name: string;
}

/**
 * Fixes a language's spelling everywhere at once: its courses and teachers
 * carry the name as text until the screens read it through the id
 * (expand/contract, CLAUDE.md §7), and the repository rewrites both.
 */
export class RenameLanguageUseCase extends BaseUseCase<RenameLanguageInput, Language> {
  constructor(
    private readonly languages: ILanguageRepository,
    private readonly auditLog: IAuditLogRepository,
  ) {
    super();
  }

  async run(input: RenameLanguageInput): Promise<Language> {
    const language = await this.languages.findById(input.id);
    if (!language || language.isDeleted) throw new LanguageNotFoundError();

    const previous = language.name;
    if (!language.rename(input.name)) return language;

    await this.languages.rename(language);
    await this.auditLog.append({
      actorId: input.actorId,
      action: "catalog.language.renamed",
      targetId: language.id,
      metadata: { from: previous, to: language.name },
      at: language.updatedAt,
    });
    return language;
  }
}
