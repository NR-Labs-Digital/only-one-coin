import type { ClassGroupDeleteBlocker } from "../DeleteClassGroupsUseCase.js";

/** What happened to one class group asked to be deleted. */
export type ClassGroupDeleteOutcome =
  | { outcome: "deleted" }
  | { outcome: "not_found" }
  | { outcome: "blocked"; blocker: ClassGroupDeleteBlocker };

/**
 * The one physical delete the catalog has: a class group nobody ever touched,
 * with its module runs (CLAUDE.md §1, "Catálogo sai do ar, não some", and its
 * exception). Everything else in the catalog has no delete to offer.
 *
 * One call, one class group, one transaction: the class group is locked, the
 * blockers are read again under the lock, and the audit entry is written in
 * the same transaction as the delete.
 */
export interface IClassGroupDeletionRepository {
  delete(params: { id: string; actorId: string; at: Date }): Promise<ClassGroupDeleteOutcome>;
}
