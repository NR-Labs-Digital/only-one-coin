import type { Weekday, WeeklySlotItem } from '@/lib/backoffice/types'
import { toMinutes } from '@/lib/backoffice/availability'
import { isoToLimaDate } from '@/lib/backoffice/lima-date'
import type { TeachingClassGroup } from './teaching'

/**
 * Calendar arithmetic for the teacher's agenda. Every date here is a calendar
 * day in Lima as `YYYY-MM-DD` — the shape `AgendaClassGroup.startDate` carries —
 * and the math runs in UTC on purpose: a date-only value has no timezone, and
 * converting it would shift it a day (`lib/format.ts`, `formatDate`).
 *
 * No UI copy here: weekday codes and times only, resolved by the locale
 * (CLAUDE.md §4).
 */

const DAY_MS = 24 * 60 * 60 * 1000

const BY_UTC_DAY: Weekday[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

function toDate(day: string): Date {
  return new Date(`${day}T00:00:00Z`)
}

function toDay(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export function addDays(day: string, amount: number): string {
  return toDay(new Date(toDate(day).getTime() + amount * DAY_MS))
}

export function addMonths(day: string, amount: number): string {
  const date = toDate(day)
  return toDay(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + amount, 1)))
}

export function weekdayOf(day: string): Weekday {
  return BY_UTC_DAY[toDate(day).getUTCDay()]
}

/** The Monday of the week `day` falls in — the week is read Monday first. */
export function startOfWeek(day: string): string {
  const offset = (toDate(day).getUTCDay() + 6) % 7
  return addDays(day, -offset)
}

export function weekDays(day: string): string[] {
  const monday = startOfWeek(day)
  return Array.from({ length: 7 }, (_, index) => addDays(monday, index))
}

export function startOfMonth(day: string): string {
  return `${day.slice(0, 7)}-01`
}

/**
 * The month as six full weeks, Monday first — always 42 cells, like a wall
 * calendar, so the grid never changes height between months.
 */
export function monthGrid(day: string): string[] {
  const first = startOfWeek(startOfMonth(day))
  return Array.from({ length: 42 }, (_, index) => addDays(first, index))
}

/**
 * A class group as the agenda places it: its week, and its first and last
 * day as Lima calendar days (`YYYY-MM-DD`). Built from the API's class group
 * by `agendaClassGroup`; one without dates (a draft) never reaches here.
 */
export interface AgendaClassGroup {
  id: string
  courseName: string
  code: string
  academicPeriodName: string
  status: TeachingClassGroup['status']
  slots: WeeklySlotItem[]
  startDate: string
  endDate: string
}

export function agendaClassGroup(group: TeachingClassGroup): AgendaClassGroup | null {
  if (!group.startsOn || !group.endsOn) return null
  return {
    id: group.id,
    courseName: group.courseName,
    code: group.code,
    academicPeriodName: group.academicPeriodName,
    status: group.status,
    slots: group.slots,
    startDate: isoToLimaDate(group.startsOn),
    endDate: isoToLimaDate(group.endsOn),
  }
}

/** One class on one day — one of a class group's weekly slots, landed on a date. */
export interface AgendaEvent {
  group: AgendaClassGroup
  day: string
  startTime: string
  endTime: string
  startMinutes: number
  durationMinutes: number
}

/**
 * The classes a set of class groups puts on one day: every slot on that
 * weekday, while the day sits between the group's first and last date.
 * Earliest first.
 */
export function eventsOn(groups: AgendaClassGroup[], day: string): AgendaEvent[] {
  const weekday = weekdayOf(day)
  return groups
    .filter((group) => group.startDate <= day && day <= group.endDate)
    .flatMap((group) =>
      group.slots
        .filter((slot) => slot.weekday === weekday)
        .map((slot) => ({
          group,
          day,
          startTime: slot.startTime,
          endTime: slot.endTime,
          startMinutes: toMinutes(slot.startTime),
          durationMinutes: toMinutes(slot.endTime) - toMinutes(slot.startTime),
        })),
    )
    .sort((a, b) => a.startMinutes - b.startMinutes)
}
