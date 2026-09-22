import { BaseUseCase } from "../shared/base/BaseUseCase.js";
import { CatalogEntryNotFoundError } from "./errors.js";
import type { CatalogEntryKind } from "./CatalogEntry.js";
import type { IAuditLogRepository } from "../identity/ports/IAuditLogRepository.js";
import type { ICatalogEntryRepository } from "./ports/ICatalogEntryRepository.js";

export interface RestoreCatalogEntryInput {
  actorId: string;
  kind: CatalogEntryKind;
  id: string;
}

export interface RestoreCatalogEntryOutput {
  kind: CatalogEntryKind;
  id: string;
  /** Always null on success — this is what "back on the shelf" means. */
  retiredAt: null;
  liveEnrollments: number;
}

/**
 * Puts a retired catalog entry back on offer.
 *
 * The counterpart exists for the same reason `RestoreStaffAccessUseCase` does:
 * without it a mistaken click is unfixable in this codebase. There is no
 * DELETE to undo it with (CLAUDE.md §6) and no hand-run SQL in production
 * (§7) — the only way back would be a migration, which is an absurd price for
 * a wrong id. Retiring is reversible on purpose; what is irreversible is
 * losing the row.
 */
export class RestoreCatalogEntryUseCase extends BaseUseCase<
  RestoreCatalogEntryInput,
  RestoreCatalogEntryOutput
> {
  constructor(
    private readonly catalog: ICatalogEntryRepository,
    private readonly auditLog: IAuditLogRepository,
  ) {
    super();
  }

  async run(input: RestoreCatalogEntryInput): Promise<RestoreCatalogEntryOutput> {
    const entry = await this.catalog.find(input.kind, input.id);

    if (!entry) {
      throw new CatalogEntryNotFoundError();
    }

    const answer: RestoreCatalogEntryOutput = {
      kind: entry.kind,
      id: entry.id,
      retiredAt: null,
      liveEnrollments: entry.liveEnrollments,
    };

    // Already on the shelf: nothing happened, so nothing is recorded as
    // having happened.
    if (entry.retiredAt === null) {
      return answer;
    }

    // Read before the write: a repository is free to hand back a live view of
    // the record, and after `restore` this is null by definition.
    const wasRetiredAt = entry.retiredAt.toISOString();

    const at = new Date();
    await this.catalog.restore(input.kind, input.id);

    await this.auditLog.append({
      actorId: input.actorId,
      action: "catalog.restored",
      targetId: input.id,
      metadata: { kind: entry.kind, retiredAt: wasRetiredAt },
      at,
    });

    return answer;
  }
}
