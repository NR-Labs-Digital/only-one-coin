import { ClassGroupFullError } from "@ooc/domain";
import { classGroups } from "@ooc/db";
import { and, eq, isNull, ne, sql, type SQL } from "drizzle-orm";
import type { Db } from "@/infra/db/client.js";
import { classGroupHasRoom } from "@/infra/persistence/catalog/seatCounters.js";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * One seat on a class group for a staff act — the manual enrollment and the
 * move (OOC-155). Returns whether the seat went above capacity.
 *
 * The regular seat first, in the single atomic instruction CLAUDE.md §5
 * requires: validation lives in the WHERE clause, never in application code.
 * Zero rows is full. Only then, and only when the staff member confirmed it,
 * one more in `seats_over` — with no ceiling (owner's decision, 14/11/2026),
 * but still never on a draft or a retired class group. Without the
 * confirmation a full class group is refused, as before.
 *
 * No enrollment-window or status-beyond-draft check here on purpose: staff
 * acting outside the window is the documented exception (apps/api/CLAUDE.md,
 * Vagas). The caller narrows what it accepts with `where` (the move passes
 * `movableClassGroup()`), checked inside the same UPDATE.
 */
export async function takeManualSeat(
  tx: Tx,
  params: { classGroupId: string; allowOverCapacity: boolean; where?: SQL },
): Promise<boolean> {
  const taken = await takeManualSeatInOrder(tx, {
    candidates: [params.classGroupId],
    allowOverCapacity: params.allowOverCapacity,
    where: params.where,
  });
  return taken.overCapacity;
}

/**
 * The same seat, over the class groups of one schedule (OOC-145): the
 * backoffice picked the hour and the API picks the class group, as the
 * checkout claim does. A regular seat in each candidate, in the order given —
 * one atomic UPDATE each, so two staff members after the last seat never both
 * get it — and, only when every one of them is full and the staff member
 * confirmed, one more in `seats_over` of the first that is still open.
 * Answers where the seat landed.
 */
export async function takeManualSeatInOrder(
  tx: Tx,
  params: { candidates: readonly string[]; allowOverCapacity: boolean; where?: SQL },
): Promise<{ classGroupId: string; overCapacity: boolean }> {
  const available = (classGroupId: string) =>
    and(eq(classGroups.id, classGroupId), isNull(classGroups.deletedAt), ne(classGroups.status, "draft"), params.where);

  for (const classGroupId of params.candidates) {
    const [regular] = await tx
      .update(classGroups)
      .set({ seatsTaken: sql`${classGroups.seatsTaken} + 1` })
      .where(and(available(classGroupId), classGroupHasRoom()))
      .returning({ id: classGroups.id });
    if (regular) return { classGroupId: regular.id, overCapacity: false };
  }

  if (!params.allowOverCapacity) throw new ClassGroupFullError();

  for (const classGroupId of params.candidates) {
    const [over] = await tx
      .update(classGroups)
      .set({ seatsOver: sql`${classGroups.seatsOver} + 1` })
      .where(available(classGroupId))
      .returning({ id: classGroups.id });
    if (over) return { classGroupId: over.id, overCapacity: true };
  }
  // Zero rows here is not "full": every candidate is a draft, retired or
  // gone. The same answer the caller already handles.
  throw new ClassGroupFullError();
}
