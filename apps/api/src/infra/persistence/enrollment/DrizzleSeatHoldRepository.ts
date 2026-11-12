import {
  byClassGroupFillOrder,
  classGroupOfferKey,
  type ClaimSeatHoldResult,
  type EnrollmentOrigin,
  type ISeatHoldRepository,
  type OfferFields,
  type OfferSlot,
  type SeatHold,
} from "@ooc/domain";
import { classGroups, seatHolds } from "@ooc/db";
import { and, eq, lt, ne, sql } from "drizzle-orm";
import type { Db } from "@/infra/db/client.js";
import { sellableClassGroup } from "@/infra/persistence/catalog/sellableClassGroup.js";

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
 * The checkout hold against the class group's seat counter. Every seat taken
 * or given back here is one atomic statement whose WHERE clause is the whole
 * check (apps/api/CLAUDE.md, "Vagas — condição de corrida"); nothing reads the
 * counter first and decides in application code.
 *
 * Lock order is always seat_holds → class_groups (release, expiry) or
 * class_groups alone followed by a fresh insert (claim), and the submit only
 * ever locks the hold — no two paths can wait on each other in a cycle.
 */
export class DrizzleSeatHoldRepository implements ISeatHoldRepository {
  constructor(private readonly db: Db) {}

  async claim(params: {
    classGroupId: string;
    origin: EnrollmentOrigin;
    holdMinutes: number;
  }): Promise<ClaimSeatHoldResult> {
    return this.db.transaction(async (tx) => {
      // The reader picks a schedule, not a class group (OOC-140): the id
      // names one group of the offer, and the seat goes to the first group of
      // that offer with room, in fill order (OOC-145). The siblings are worked
      // out here from the database, never taken from the client.
      const candidates = await this.offerOf(tx, params.classGroupId);
      if (candidates.length === 0) return { kind: "not_found" };

      let taken: string | null = null;
      for (const candidateId of candidates) {
        // What the public checkout may sell: on sale right now (enrolling,
        // not retired, inside its enrollment window, its period and course
        // not retired — sellableClassGroup, the same definition the catalog
        // reads list through; CLAUDE.md §1, "Catálogo sai do ar, não some").
        // Checked again inside the UPDATE: the list above was read without a
        // lock, and the WHERE clause is the whole check (CLAUDE.md §8).
        //
        // One atomic statement per group. A claim racing for the same seat
        // waits on the row lock and re-checks `seats_taken < capacity` on the
        // committed row, so the last seat goes to one claim and the other
        // moves on to the next group.
        const [seat] = await tx
          .update(classGroups)
          .set({ seatsTaken: sql`${classGroups.seatsTaken} + 1` })
          .where(
            and(
              eq(classGroups.id, candidateId),
              sellableClassGroup(),
              lt(classGroups.seatsTaken, classGroups.capacity),
              // A draft has no dates and is not on sale (OOC-35). Already
              // implied by sellableClassGroup() — spelled out so the rule
              // survives a change to it.
              ne(classGroups.status, "draft"),
            ),
          )
          .returning({ id: classGroups.id });
        if (seat) {
          taken = seat.id;
          break;
        }
      }

      if (!taken) return { kind: "full" };

      const [row] = await tx
        .insert(seatHolds)
        .values({
          classGroupId: taken,
          origin: params.origin,
          // The database clock, not this process's: the submit and the sweep
          // compare against `now()` too, and one clock cannot disagree with
          // itself.
          expiresAt: sql`now() + make_interval(mins => ${params.holdMinutes}::int)`,
        })
        .returning();

      if (!row) {
        throw new Error("Insert into seat_holds returned no row");
      }

      return {
        kind: "held",
        hold: {
          id: row.id,
          classGroupId: row.classGroupId,
          origin: row.origin as EnrollmentOrigin,
          expiresAt: row.expiresAt,
        },
      };
    });
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
  private async offerOf(tx: Tx, classGroupId: string): Promise<string[]> {
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

  async find(id: string): Promise<SeatHold | null> {
    const [row] = await this.db
      .select({
        id: seatHolds.id,
        classGroupId: seatHolds.classGroupId,
        origin: seatHolds.origin,
        expiresAt: seatHolds.expiresAt,
      })
      .from(seatHolds)
      .where(eq(seatHolds.id, id))
      .limit(1);

    return row ? { ...row, origin: row.origin as EnrollmentOrigin } : null;
  }

  async release(id: string): Promise<boolean> {
    // One statement: the hold leaves `active` and its seat goes back, or
    // neither happens. A hold that already left `active` matches nothing, so
    // a second release never hands back a second seat.
    const result = await this.db.execute<{ id: string }>(sql`
      with released as (
        update ${seatHolds}
           set "status" = 'released', "settled_at" = now(), "updated_at" = now()
         where "id" = ${id} and "status" = 'active'
        returning "class_group_id"
      )
      update ${classGroups} g
         set "seats_taken" = g."seats_taken" - 1
        from released
       where g."id" = released."class_group_id"
      returning g."id" as "id"
    `);

    return result.rows.length > 0;
  }

  async expireDue(limit: number): Promise<number> {
    // One statement for the whole batch: the holds whose clock ran out become
    // `expired` and their class groups get the seats back, grouped so a class
    // group losing three holds at once is updated once.
    //
    // SKIP LOCKED is what keeps this out of a submit's way: a hold the submit
    // has locked (FOR UPDATE in DrizzlePublicEnrollmentRepository) is left
    // for the next tick, by which time it is either consumed or still due.
    // Data-modifying CTEs always run to completion, whether or not the final
    // SELECT reads them.
    const result = await this.db.execute<{ expired: number }>(sql`
      with due as (
        select "id"
          from ${seatHolds}
         where "status" = 'active' and "expires_at" <= now()
         order by "expires_at"
         limit ${limit}
           for update skip locked
      ),
      expired as (
        update ${seatHolds} h
           set "status" = 'expired', "settled_at" = now(), "updated_at" = now()
          from due
         where h."id" = due."id"
        returning h."class_group_id"
      ),
      per_group as (
        select "class_group_id", count(*)::int as n
          from expired
         group by "class_group_id"
      ),
      returned as (
        update ${classGroups} g
           set "seats_taken" = g."seats_taken" - per_group.n
          from per_group
         where g."id" = per_group."class_group_id"
        returning g."id"
      )
      select count(*)::int as "expired" from expired
    `);

    return result.rows[0]?.expired ?? 0;
  }
}
