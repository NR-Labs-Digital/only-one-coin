import { z } from "zod";

/**
 * The four things the catalog is made of, as a closed union rather than a
 * loose string (CLAUDE.md §4 — "se um dado da UI pode ser código, o tipo diz
 * qual é"). The values match the table names in packages/db, which is what
 * makes a wire value readable without a lookup table.
 *
 * All four share one lifecycle — offered, then retired — so they share one
 * usecase instead of four near-identical ones. What differs between them is
 * only how many enrollments hang off each, which is a question for the
 * repository.
 */
export const CatalogEntryKindSchema = z.enum([
  "academic_period",
  "course",
  "plan",
  "class_group",
]);

export type CatalogEntryKind = z.infer<typeof CatalogEntryKindSchema>;

export interface CatalogEntryState {
  kind: CatalogEntryKind;
  id: string;
  /** Null while the entry is still on offer. */
  retiredAt: Date | null;
  /**
   * Enrollments still standing on this entry — not retired, and still holding
   * a seat (a released seat is already gone). Reported, never a blocker: see
   * RetireCatalogEntryUseCase.
   */
  liveEnrollments: number;
}
