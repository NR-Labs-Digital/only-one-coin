import { BaseUseCase } from "../shared/base/BaseUseCase.js";
import { CatalogEntryNotFoundError } from "./errors.js";
import type { CatalogEntryKind } from "./CatalogEntry.js";
import type { IAuditLogRepository } from "../identity/ports/IAuditLogRepository.js";
import type { ICatalogEntryRepository } from "./ports/ICatalogEntryRepository.js";

export interface RetireCatalogEntryInput {
  actorId: string;
  kind: CatalogEntryKind;
  id: string;
}

export interface RetireCatalogEntryOutput {
  kind: CatalogEntryKind;
  id: string;
  retiredAt: Date;
  /** How many enrollments were still standing on it when it came off the shelf. */
  liveEnrollments: number;
}

/**
 * Takes a catalog entry off the shelf. The row stays, with `deleted_at` set —
 * the only delete there is (CLAUDE.md §6), and the only one Postgres allows on
 * the tables migration 0011 locked.
 *
 * **Live enrollments do not block it.** That follows the precedent §1 already
 * set for a teacher leaving the roster — "avisa, não bloqueia — quem larga no
 * meio do ciclo é caso real, e travar deixaria a ficha presa". A course whose
 * last class group is still running is exactly the course somebody needs to
 * stop selling, so the count comes back in the answer instead of in a refusal.
 *
 * Retiring does not cascade in writes and does not need to: the reads that
 * serve the catalog filter every table they are about, so a retired course
 * takes its plans and class groups off the offer on its own, and putting the
 * course back brings them back with it — which a cascade of writes could not
 * do without remembering what it had touched.
 */
export class RetireCatalogEntryUseCase extends BaseUseCase<
  RetireCatalogEntryInput,
  RetireCatalogEntryOutput
> {
  constructor(
    private readonly catalog: ICatalogEntryRepository,
    private readonly auditLog: IAuditLogRepository,
  ) {
    super();
  }

  async run(input: RetireCatalogEntryInput): Promise<RetireCatalogEntryOutput> {
    const entry = await this.catalog.find(input.kind, input.id);

    if (!entry) {
      throw new CatalogEntryNotFoundError();
    }

    // Idempotent, first date wins — same shape as SoftDeletableModel. A retry
    // (a double click, a re-run) must not move when it left, and must not
    // leave a second line in the audit trail saying it happened twice.
    if (entry.retiredAt !== null) {
      return {
        kind: entry.kind,
        id: entry.id,
        retiredAt: entry.retiredAt,
        liveEnrollments: entry.liveEnrollments,
      };
    }

    const at = new Date();
    await this.catalog.retire(input.kind, input.id, at);

    await this.auditLog.append({
      actorId: input.actorId,
      action: "catalog.retired",
      targetId: input.id,
      // What it was and what it was still carrying: reading the trail later,
      // "retired a class group with 12 people on it" is the line that matters.
      metadata: { kind: entry.kind, liveEnrollments: entry.liveEnrollments },
      at,
    });

    return {
      kind: entry.kind,
      id: entry.id,
      retiredAt: at,
      liveEnrollments: entry.liveEnrollments,
    };
  }
}
