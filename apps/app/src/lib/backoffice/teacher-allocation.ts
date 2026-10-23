import { toMinutes } from './availability'
import type { TeacherOption, WeeklySlotItem } from './types'

/** Teacher languages and `courses.language` are the same free text — the API compares them the same way. */
function sameLanguage(a: string, b: string): boolean {
  return a.trim().toLocaleLowerCase('es') === b.trim().toLocaleLowerCase('es')
}

/** Who the class group form offers for a course: the roster, cut to the course's language. */
export function teachersForLanguage(options: TeacherOption[], language: string): TeacherOption[] {
  return options.filter((teacher) => teacher.languages.some((item) => sameLanguage(item, language)))
}

function overlaps(a: WeeklySlotItem, b: WeeklySlotItem): boolean {
  return (
    a.weekday === b.weekday &&
    toMinutes(a.startTime) < toMinutes(b.endTime) &&
    toMinutes(b.startTime) < toMinutes(a.endTime)
  )
}

function inside(slot: WeeklySlotItem, window: WeeklySlotItem): boolean {
  return (
    slot.weekday === window.weekday &&
    toMinutes(slot.startTime) >= toMinutes(window.startTime) &&
    toMinutes(slot.endTime) <= toMinutes(window.endTime)
  )
}

export interface AllocationWarnings {
  /** The schedule leaves the week the teacher declared. False when they declared none — nothing to compare. */
  outsideAvailability: boolean
  /** Codes of their other class groups, in the same period, that meet at the same time. */
  clashes: string[]
}

/**
 * What the form warns about when allocating a teacher (OOC-80) — never a
 * refusal: the declared week can be out of date, and a teacher covering two
 * class groups in a pinch is a real case. Only the same period counts as a
 * clash, because a class group of another period runs on other dates.
 */
export function allocationWarnings(
  teacher: TeacherOption,
  slots: WeeklySlotItem[],
  context: { academicPeriodId: string; classGroupId?: string },
): AllocationWarnings {
  const outsideAvailability =
    teacher.availability.length > 0 &&
    slots.some((slot) => !teacher.availability.some((window) => inside(slot, window)))

  const clashes = teacher.classGroups
    .filter(
      (group) =>
        group.id !== context.classGroupId &&
        group.academicPeriodId === context.academicPeriodId &&
        group.slots.some((theirs) => slots.some((ours) => overlaps(theirs, ours))),
    )
    .map((group) => group.code)

  return { outsideAvailability, clashes }
}
