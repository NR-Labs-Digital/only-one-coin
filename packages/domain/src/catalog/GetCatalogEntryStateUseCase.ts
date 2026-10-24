import { BaseUseCase } from "../shared/base/BaseUseCase.js";
import { CatalogEntryNotFoundError } from "./errors.js";
import type { CatalogEntryKind, CatalogEntryState } from "./CatalogEntry.js";
import type { ICatalogEntryRepository } from "./ports/ICatalogEntryRepository.js";

export interface GetCatalogEntryStateInput {
  kind: CatalogEntryKind;
  id: string;
}

/**
 * Where an entry stands before anyone touches it: retired or not, and how
 * many enrollments still hang off it (OOC-70). The panel reads it to say the
 * count *before* the confirmation, not only in the toast after — the warning
 * CLAUDE.md §1 asks for ("avisa, não bloqueia") is only a warning if it comes
 * while the person can still change their mind.
 *
 * A read: it writes nothing and leaves no audit line. The same count comes
 * back again from the retire itself, which is what the audit trail keeps.
 */
export class GetCatalogEntryStateUseCase extends BaseUseCase<
  GetCatalogEntryStateInput,
  CatalogEntryState
> {
  constructor(private readonly catalog: ICatalogEntryRepository) {
    super();
  }

  async run(input: GetCatalogEntryStateInput): Promise<CatalogEntryState> {
    const entry = await this.catalog.find(input.kind, input.id);

    if (!entry) {
      throw new CatalogEntryNotFoundError();
    }

    return entry;
  }
}
