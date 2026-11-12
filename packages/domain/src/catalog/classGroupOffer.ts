/**
 * What makes class groups one offer to the person enrolling (OOC-140), and
 * the order their seats are taken in (OOC-145).
 *
 * Coordination opens several class groups of the same course at the same
 * hour when demand is larger than one group. To the reader they are one
 * choice; which group the seat lands in is the institution's business. The
 * checkout groups them on screen with this key, and the API's seat claim
 * fills them in this order, so the two can never disagree about which class
 * groups are siblings.
 *
 * Imported by the browser through `@ooc/domain/class-group-offer`, so this
 * file stays self-contained: no dependency and no relative import
 * (packages/domain/CLAUDE.md).
 */

/** A weekly slot as stored on the class group (`WeeklySlot`). */
export interface OfferSlot {
  weekday: string;
  startTime: string;
  endTime: string;
}

/** The fields that decide the offer. Dates are ISO instants, as the catalog sends them. */
export interface OfferFields {
  courseId: string;
  startsOn: string;
  endsOn: string;
  slots: readonly OfferSlot[];
}

const WEEKDAY_ORDER = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

/**
 * Same course, same dates, same week. The code, the teacher and the
 * Classroom are not something the reader chooses, so they are not in it.
 */
export function classGroupOfferKey(group: OfferFields): string {
  const week = [...group.slots]
    .sort(
      (a, b) =>
        WEEKDAY_ORDER.indexOf(a.weekday) - WEEKDAY_ORDER.indexOf(b.weekday) ||
        a.startTime.localeCompare(b.startTime),
    )
    .map((slot) => `${slot.weekday}@${slot.startTime}-${slot.endTime}`)
    .join("|");
  return `${group.courseId}#${group.startsOn}#${group.endsOn}#${week}`;
}

/**
 * Fill order: by code, which is the order the groups were opened in
 * (`A-` + a sequence). The first fills up before the next takes anybody —
 * coordination opens five groups of thirty, not five groups of six. The id
 * breaks a tie between legacy rows that share a code.
 */
export function byClassGroupFillOrder(
  a: { code: string; id: string },
  b: { code: string; id: string },
): number {
  return a.code.localeCompare(b.code, "en", { numeric: true }) || a.id.localeCompare(b.id);
}
