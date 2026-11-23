import { BaseUseCase } from "../shared/base/BaseUseCase.js";
import type {
  ClassGroupDeleteOutcome,
  IClassGroupDeletionRepository,
} from "./ports/IClassGroupDeletionRepository.js";

/**
 * Why a class group cannot be deleted, only retired. Each one is a record that
 * points at it and must keep pointing (CLAUDE.md §6):
 *
 * - `enrollments` — someone was enrolled in it, whatever happened next
 *   (released seats, freezes, grades and issued documents included).
 * - `waitlist` — someone waited for a seat in it.
 * - `checkout` — a checkout is holding a seat in it right now, or a hold in
 *   it already carries a receipt or an e-mail check.
 * - `copies` — a later period was duplicated from it (OOC-35).
 * - `history` — anything else Postgres refuses to let go of. Should not
 *   happen; it is the net under the list above.
 */
export const CLASS_GROUP_DELETE_BLOCKERS = ["enrollments", "waitlist", "checkout", "copies", "history"] as const;

export type ClassGroupDeleteBlocker = (typeof CLASS_GROUP_DELETE_BLOCKERS)[number];

/** How many class groups one request may name — a limit on the request, not a business rule. */
export const MAX_CLASS_GROUPS_PER_DELETE = 100;

export interface DeleteClassGroupsInput {
  actorId: string;
  ids: string[];
}

export type DeleteClassGroupsResult = { id: string } & ClassGroupDeleteOutcome;

/**
 * Deletes, for good, the class groups that never touched a person — the
 * exception to "Catálogo sai do ar, não some" (decided with the owner,
 * 23/11/2026): a class group opened by mistake, or a test one, that nobody
 * bought, waited for or copied. Anything with a trace keeps the old path:
 * retire it.
 *
 * Each class group is its own transaction, so one refusal never undoes the
 * others; the answer says, per id, what happened. A repeated id is deleted
 * once. Nothing here undoes a delete — the confirmation on screen is the
 * last step.
 */
export class DeleteClassGroupsUseCase extends BaseUseCase<DeleteClassGroupsInput, DeleteClassGroupsResult[]> {
  constructor(private readonly deletions: IClassGroupDeletionRepository) {
    super();
  }

  async run(input: DeleteClassGroupsInput): Promise<DeleteClassGroupsResult[]> {
    const ids = [...new Set(input.ids)].slice(0, MAX_CLASS_GROUPS_PER_DELETE);
    const at = new Date();
    const results: DeleteClassGroupsResult[] = [];
    // One at a time: each locks its class group, and a request of a hundred
    // should not take a hundred connections.
    for (const id of ids) {
      results.push({ id, ...(await this.deletions.delete({ id, actorId: input.actorId, at })) });
    }
    return results;
  }
}
