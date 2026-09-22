import type { CatalogEntryKind, CatalogEntryState } from "../CatalogEntry.js";

/**
 * Deliberately narrow, and deliberately without a `delete`: the catalog is
 * pointed at by enrollments that already happened, and CLAUDE.md §6 leaves no
 * physical delete to offer — migration 0011 makes Postgres say the same.
 *
 * `retire` and `restore` take the kind because the four catalog tables are one
 * concept with four homes; resolving that to a table is infrastructure's job,
 * not the domain's.
 */
export interface ICatalogEntryRepository {
  find(kind: CatalogEntryKind, id: string): Promise<CatalogEntryState | null>;
  retire(kind: CatalogEntryKind, id: string, at: Date): Promise<void>;
  restore(kind: CatalogEntryKind, id: string): Promise<void>;
}
