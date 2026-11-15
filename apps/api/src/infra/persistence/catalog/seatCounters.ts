import { classGroups } from "@ooc/db";
import { and, eq, gt, sql, type SQL } from "drizzle-orm";
import type { Db } from "@/infra/db/client.js";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * A class group has room while the seats it holds — within capacity and above
 * it — are fewer than its capacity (OOC-155). The single definition of "room
 * left": the checkout claim, the manual enrollment, the move, the open-group
 * reads and the "full" queues all read through these two, so a class group
 * that went 30/30 +2 never shows a free seat when one regular seat comes back.
 */
export function classGroupHasRoom(): SQL {
  return sql`${classGroups.seatsTaken} + ${classGroups.seatsOver} < ${classGroups.capacity}`;
}

export function classGroupIsFull(): SQL {
  return sql`${classGroups.seatsTaken} + ${classGroups.seatsOver} >= ${classGroups.capacity}`;
}

/**
 * Hands one seat back to the counter it was taken from: `seats_over` for an
 * enrollment above capacity, `seats_taken` for every other. The `> 0` guard
 * keeps the CHECKs from turning a double release into a failed transaction.
 */
export async function giveBackSeat(
  tx: Tx,
  params: { classGroupId: string; overCapacity: boolean },
): Promise<void> {
  if (params.overCapacity) {
    await tx
      .update(classGroups)
      .set({ seatsOver: sql`${classGroups.seatsOver} - 1` })
      .where(and(eq(classGroups.id, params.classGroupId), gt(classGroups.seatsOver, 0)));
    return;
  }
  await tx
    .update(classGroups)
    .set({ seatsTaken: sql`${classGroups.seatsTaken} - 1` })
    .where(and(eq(classGroups.id, params.classGroupId), gt(classGroups.seatsTaken, 0)));
}
