import type { AvailabilitySlot, ClassGroupItem, Weekday } from './types'

/**
 * Weekly availability, as data. No UI copy here — the weekday codes are
 * resolved to words by the locale (CLAUDE.md §4), and the times are `HH:mm`
 * in America/Lima, the same shape a class group's `slots` use.
 */

/** Monday first, the way the schedule is read. */
export const WEEK: Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']

/** `HH:mm` → minutes since midnight, so ranges can be compared as numbers. */
export function toMinutes(time: string): number {
  const [hours, minutes] = time.split(':')
  return Number(hours) * 60 + Number(minutes)
}

/** Hours a teacher declared free in a week — the ceiling on what they can take. */
export function weeklyHours(slots: AvailabilitySlot[]): number {
  const minutes = slots.reduce(
    (sum, slot) => sum + Math.max(0, toMinutes(slot.endTime) - toMinutes(slot.startTime)),
    0,
  )
  return Math.round((minutes / 60) * 10) / 10
}

/** A class group laid over the day it was allocated into. */
export interface AllocatedClass {
  id: string
  code: string
  courseName: string
  startTime: string
  endTime: string
  /**
   * The meeting does not fit inside any window the teacher declared. Not an
   * error the screen may fix — availability is declared, allocation is decided,
   * and when they disagree a human has to know which one is stale.
   */
  outside: boolean
}

export interface DayColumn {
  weekday: Weekday
  slots: AvailabilitySlot[]
  classes: AllocatedClass[]
}

const byStart = (a: { startTime: string }, b: { startTime: string }) =>
  toMinutes(a.startTime) - toMinutes(b.startTime)

/**
 * The week as seven columns: what the teacher offered and what was already put
 * on top of it. Both together, because the question the screen answers is
 * "where does the next class group fit", not "what did they write down".
 */
export function weekColumns(
  availability: AvailabilitySlot[],
  classGroups: ClassGroupItem[],
): DayColumn[] {
  return WEEK.map((weekday) => {
    const slots = availability.filter((slot) => slot.weekday === weekday).sort(byStart)
    const classes = classGroups
      .flatMap((group) =>
        group.slots
          .filter((meeting) => meeting.weekday === weekday)
          .map((meeting) => ({
            id: group.id,
            code: group.code,
            courseName: group.courseName,
            startTime: meeting.startTime,
            endTime: meeting.endTime,
            outside: !slots.some(
              (slot) =>
                toMinutes(meeting.startTime) >= toMinutes(slot.startTime) &&
                toMinutes(meeting.endTime) <= toMinutes(slot.endTime),
            ),
          })),
      )
      .sort(byStart)
    return { weekday, slots, classes }
  })
}

/** Half-hour marks from 06:00 to 22:00 — what the pickers offer. */
export const TIME_OPTIONS: string[] = Array.from({ length: 33 }, (_, i) => {
  const minutes = 6 * 60 + i * 30
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
})
