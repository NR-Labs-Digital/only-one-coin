import {
  byClassGroupFillOrder,
  staffOfferKey,
  type OfferSlot,
  type SeatPlacement,
} from '@ooc/domain/class-group-offer'

/**
 * Class groups of one schedule as one choice in a backoffice picker
 * (OOC-145), without losing the codes.
 *
 * Coordination opens several class groups of the same course at the same
 * hour. In the manual enrollment and in the move to another module, which of
 * them takes the seat does not matter — the API fills them in code order, as
 * the checkout does. Moving a student between two of them does matter, and
 * there the code is how staff finds it. So a schedule with more than one class
 * group shows both: one "first with room" choice and each code below it.
 *
 * The grouping key is `staffOfferKey`, the one the API's seat search reads,
 * so a choice on screen and the class groups the API tries are the same set.
 */

/** One entry of a picker: a class group (manual enrollment) or a module run (move). */
export interface OfferMember {
  /** What the API names: the class group's id, or the run's. */
  id: string
  classGroupId: string
  code: string
  courseId: string
  academicPeriodId: string
  startsOn: string | null
  endsOn: string | null
  slots: readonly OfferSlot[]
  module?: number | null
  fullCourse?: boolean
  capacity: number
  seatsTaken: number
  seatsOver: number
}

export interface PickerOffer<T extends OfferMember> {
  key: string
  /** Own class group first (its seat never moves), then fill order. */
  members: T[]
}

function offerKeyOf(member: OfferMember): string {
  // A class group without dates is never a sibling of anything.
  if (!member.startsOn || !member.endsOn) return `alone#${member.id}`
  return staffOfferKey({
    courseId: member.courseId,
    academicPeriodId: member.academicPeriodId,
    startsOn: member.startsOn,
    endsOn: member.endsOn,
    slots: member.slots,
    module: member.module,
    fullCourse: member.fullCourse,
  })
}

/**
 * The picker's entries grouped by schedule, in the order the list first
 * mentions each schedule. `ownClassGroupId` is the class group the seat is in
 * now (the move); its run goes first, as the API tries it first.
 */
export function groupOffers<T extends OfferMember>(
  items: readonly T[],
  ownClassGroupId: string | null = null,
): PickerOffer<T>[] {
  const byKey = new Map<string, T[]>()
  for (const item of items) {
    const key = offerKeyOf(item)
    const members = byKey.get(key)
    if (members) members.push(item)
    else byKey.set(key, [item])
  }
  const own = (member: T) => (member.classGroupId === ownClassGroupId ? 0 : 1)
  return [...byKey].map(([key, members]) => ({
    key,
    members: [...members].sort(
      (a, b) =>
        own(a) - own(b) ||
        byClassGroupFillOrder({ code: a.code, id: a.classGroupId }, { code: b.code, id: b.classGroupId }),
    ),
  }))
}

/** Regular seats left, never negative: a class group above capacity has none. */
export function seatsLeft(member: OfferMember): number {
  return Math.max(0, member.capacity - member.seatsTaken - member.seatsOver)
}

/** The regular seats of the whole schedule. */
export function offerSeatsLeft(members: readonly OfferMember[]): number {
  return members.reduce((sum, member) => sum + seatsLeft(member), 0)
}

const SCHEDULE_PREFIX = 'schedule:'

/** The `<option>` value: a member's id, or "the schedule of this member". */
export function pickerValue(placement: SeatPlacement, id: string): string {
  return placement === 'schedule' ? `${SCHEDULE_PREFIX}${id}` : id
}

/** Null for the placeholder. */
export function parsePickerValue(value: string): { placement: SeatPlacement; id: string } | null {
  if (value === '') return null
  return value.startsWith(SCHEDULE_PREFIX)
    ? { placement: 'schedule', id: value.slice(SCHEDULE_PREFIX.length) }
    : { placement: 'class_group', id: value }
}

/**
 * What a picker value stands for: the offer and, for a single code, the
 * member. Null when the value names nothing in the list (a stale selection
 * after a reload).
 */
export function resolvePick<T extends OfferMember>(
  offers: readonly PickerOffer<T>[],
  value: string,
): { placement: SeatPlacement; offer: PickerOffer<T>; member: T } | null {
  const parsed = parsePickerValue(value)
  if (!parsed) return null
  for (const offer of offers) {
    const member = offer.members.find((item) => item.id === parsed.id)
    if (member) return { placement: parsed.placement, offer, member }
  }
  return null
}
