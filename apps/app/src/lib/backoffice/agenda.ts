import type { ClassGroupRow, Weekday } from './types'
import { toMinutes } from './availability'

/**
 * Calendar arithmetic for the teacher's agenda. Every date here is a calendar
 * day in Lima as `YYYY-MM-DD` — the same shape `ClassGroupRow.startDate` uses —
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

/** One class on one day — a class group's weekly slot, landed on a date. */
export interface AgendaEvent {
  group: ClassGroupRow
  day: string
  startTime: string
  startMinutes: number
}

/**
 * The classes a set of class groups puts on one day: the group runs on that
 * weekday and the day sits between its first and last date. Earliest first.
 */
export function eventsOn(groups: ClassGroupRow[], day: string): AgendaEvent[] {
  const weekday = weekdayOf(day)
  return groups
    .filter(
      (group) =>
        group.weekdays.includes(weekday) && group.startDate <= day && day <= group.endDate,
    )
    .map((group) => ({
      group,
      day,
      startTime: group.startTime,
      startMinutes: toMinutes(group.startTime),
    }))
    .sort((a, b) => a.startMinutes - b.startMinutes)
}
