import type { ClassGroupDeleteBlocker } from "../DeleteClassGroupsUseCase.js";

/**
 * What happened to one class group asked to be deleted: deleted for real when
 * nobody ever touched it, erased (hidden from the catalog for good) when it
 * has history, with the reason it could not go for real.
 */
export type ClassGroupDeleteOutcome =
  | { outcome: "deleted" }
  | { outcome: "erased"; reason: ClassGroupDeleteBlocker }
  | { outcome: "not_found" };

/**
 * The one way a class group leaves the catalog for good (CLAUDE.md §1,
 * exception of 23/11/2026). One call, one class group, one transaction: the
 * class group is locked, its history read again under the lock, and the audit
 * entry is written in the same transaction as the delete or the erase.
 */
export interface IClassGroupDeletionRepository {
  delete(params: { id: string; actorId: string; at: Date }): Promise<ClassGroupDeleteOutcome>;
}
