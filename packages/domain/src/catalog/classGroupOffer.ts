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

/**
 * Where a seat a staff member asks for lands (OOC-145, backoffice pickers):
 * `class_group` is exactly the one named — moving a student between two
 * class groups of the same hour is picking a code; `schedule` is the first
 * class group of the named one's offer with room, in fill order, the way the
 * checkout claim decides. The default is `class_group`: an old screen that
 * sends nothing keeps meaning what it meant.
 */
export const SEAT_PLACEMENTS = ["class_group", "schedule"] as const;
export type SeatPlacement = (typeof SEAT_PLACEMENTS)[number];

/** The fields that decide an offer in the backoffice: the checkout's, plus the period and what is taught. */
export interface StaffOfferFields extends OfferFields {
  academicPeriodId: string;
  /** The module run's module (OOC-156); absent on a picker of class groups, where every entry is the entry run. */
  module?: number | null;
  fullCourse?: boolean;
}

/**
 * One choice in a backoffice picker. Narrower than the checkout's key on
 * purpose: the API only treats class groups of the same period as siblings
 * (`offerOf`), and a move names a module run, so two runs of different
 * modules at the same hour are two choices.
 */
export function staffOfferKey(group: StaffOfferFields): string {
  const taught = group.fullCourse ? "full" : group.module == null ? "-" : String(group.module);
  return `${classGroupOfferKey(group)}#${group.academicPeriodId}#${taught}`;
}
