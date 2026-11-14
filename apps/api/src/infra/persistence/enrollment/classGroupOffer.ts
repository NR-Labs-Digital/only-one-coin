import { byClassGroupFillOrder, classGroupOfferKey, type OfferFields, type OfferSlot } from "@ooc/domain";
import { classGroups } from "@ooc/db";
import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@/infra/db/client.js";
import { sellableClassGroup } from "@/infra/persistence/catalog/sellableClassGroup.js";
import { classGroupHasRoom } from "@/infra/persistence/catalog/seatCounters.js";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * The offer fields of a class group row. `slots` is jsonb: a legacy row with
 * something other than a list of slots reads as no week at all, which only
 * ever matches another row just as empty.
 */
function offerFields(row: { courseId: string; startsOn: Date | null; endsOn: Date | null; slots: unknown }): OfferFields {
  const slots: OfferSlot[] = Array.isArray(row.slots)
    ? row.slots.filter(
        (slot): slot is OfferSlot =>
          typeof slot === "object" &&
          slot !== null &&
          typeof (slot as OfferSlot).weekday === "string" &&
          typeof (slot as OfferSlot).startTime === "string" &&
          typeof (slot as OfferSlot).endTime === "string",
      )
    : [];
  return {
    courseId: row.courseId,
    startsOn: row.startsOn?.toISOString() ?? "",
    endsOn: row.endsOn?.toISOString() ?? "",
    slots,
  };
}

/**
 * The class groups of the same offer as `classGroupId` that are on sale,
 * itself included, in fill order. Empty when the id names nothing, or
 * nothing of its offer is on sale.
 *
 * The named group may itself be off sale (retired, window closed) while a
 * sibling is still selling; the schedule the reader picked is still there.
 * Course, period and dates narrow the read in SQL; the week is compared by
 * `classGroupOfferKey`, the same function the checkout groups with.
 */
export async function offerOf(tx: Tx, classGroupId: string): Promise<string[]> {
  const [named] = await tx
    .select({
      courseId: classGroups.courseId,
      academicPeriodId: classGroups.academicPeriodId,
      startsOn: classGroups.startsOn,
      endsOn: classGroups.endsOn,
      slots: classGroups.slots,
    })
    .from(classGroups)
    .where(eq(classGroups.id, classGroupId))
    .limit(1);
  // A draft has no dates and is never on sale; nothing can be its sibling.
  if (!named?.startsOn || !named.endsOn) return [];

  const siblings = await tx
    .select({
      id: classGroups.id,
      code: classGroups.code,
      courseId: classGroups.courseId,
      startsOn: classGroups.startsOn,
      endsOn: classGroups.endsOn,
      slots: classGroups.slots,
    })
    .from(classGroups)
    .where(
      and(
        eq(classGroups.courseId, named.courseId),
        // Siblings are opened together, in one period. A class group of
        // another period at the same dates is a different sale.
        eq(classGroups.academicPeriodId, named.academicPeriodId),
        eq(classGroups.startsOn, named.startsOn),
        eq(classGroups.endsOn, named.endsOn),
        sellableClassGroup(),
      ),
    );

  const key = classGroupOfferKey(offerFields(named));
  return siblings
    .filter((group) => classGroupOfferKey(offerFields(group)) === key)
    .sort(byClassGroupFillOrder)
    .map((group) => group.id);
}

/**
 * A seat for a checkout hold that expired before its receipt came back
 * (OOC-155, case 1). The person paid with the seat in hand; the sweep gave it
 * back while they were in their banking app.
 *
 * The regular seat first, in the same fill order and the same one atomic
 * UPDATE per class group as the claim: if the schedule still has room, they
 * get it as if nothing had happened. Only when every class group of the
 * schedule is full does the seat go above capacity — one more in `seats_over`
 * of the first group in fill order, with no ceiling and no window after the
 * expiry (owner's decision, 14/11/2026).
 *
 * Null when nothing of the schedule is on sale any more: an expired hold is
 * not a ticket into a class group that stopped selling.
 */
export async function seatForExpiredHold(
  tx: Tx,
  classGroupId: string,
): Promise<{ classGroupId: string; overCapacity: boolean } | null> {
  const candidates = await offerOf(tx, classGroupId);
  if (candidates.length === 0) return null;

  for (const candidateId of candidates) {
    const [seat] = await tx
      .update(classGroups)
      .set({ seatsTaken: sql`${classGroups.seatsTaken} + 1` })
      .where(and(eq(classGroups.id, candidateId), sellableClassGroup(), classGroupHasRoom()))
      .returning({ id: classGroups.id });
    if (seat) return { classGroupId: seat.id, overCapacity: false };
  }

  const [over] = await tx
    .update(classGroups)
    .set({ seatsOver: sql`${classGroups.seatsOver} + 1` })
    .where(and(eq(classGroups.id, candidates[0]!), sellableClassGroup()))
    .returning({ id: classGroups.id });
  return over ? { classGroupId: over.id, overCapacity: true } : null;
}
