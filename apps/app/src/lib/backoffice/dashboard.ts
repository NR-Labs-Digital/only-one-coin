import { cache } from 'react'
import { apiFetch } from './api-client'
import { listPaymentReviewQueue } from './payments'
import type { ClassGroupItem, PaymentReviewQueue } from './types'

/** `GET /api/v1/dashboard/summary` — definitions in apps/api's DashboardSummaryQuery. */
export interface DashboardSummary {
  /** Enrollments whose first payment was approved today, Lima time. */
  enrollmentsToday: number
  enrollmentsYesterday: number
  /** People with a confirmed seat in a class group not yet finished or closed. */
  activeStudents: number
  activeStudentsYesterday: number
  /**
   * Seats held and offered across the current period's class groups, summed by
   * the API (OOC-160). `taken` includes the seats above capacity, so it can
   * pass `capacity`.
   */
  seatOccupancy: { taken: number; capacity: number }
}

/** The home's enrollment and active-student figures. `null` = the API failed or refused. */
export async function getDashboardSummary(): Promise<DashboardSummary | null> {
  try {
    const response = await apiFetch('/api/v1/dashboard/summary')
    if (!response.ok) return null
    return (await response.json()) as DashboardSummary
  } catch {
    return null
  }
}

/**
 * The first page of the review queue, oldest first. The panel's shell (the
 * Payments badge) and the home (its counter and preview) both read it on the
 * same request; `cache` makes that one call to `apps/api`, not two.
 */
export const getReviewQueueHead = cache(
  (): Promise<PaymentReviewQueue | null> => listPaymentReviewQueue({ page: 1, q: '', sort: 'oldest' }),
)

/** How many class groups the home shows under seat pressure. */
export const SEAT_WATCH_SIZE = 6

/** On sale right now: taking enrollments, and neither it nor its course retired. */
function onSale(group: ClassGroupItem): boolean {
  return group.status === 'enrolling' && group.active && group.courseActive
}

/**
 * Seats a class group holds, within capacity and above it (OOC-155). A class
 * group with seats above capacity is full and never shows room, even when a
 * regular seat came back — the same rule as Académico's "30 / 30 +2".
 */
export function seatsHeld(group: Pick<ClassGroupItem, 'seatsTaken' | 'seatsOver'>): number {
  return group.seatsTaken + group.seatsOver
}

/** The class groups on sale closest to full; the earliest start breaks a tie. */
export function seatsUnderPressure(groups: ClassGroupItem[]): ClassGroupItem[] {
  const fill = (group: ClassGroupItem) =>
    group.capacity === 0 ? 0 : seatsHeld(group) / group.capacity
  return groups
    .filter(onSale)
    .sort(
      (a, b) =>
        fill(b) - fill(a) || (a.startsOn ?? '').localeCompare(b.startsOn ?? ''),
    )
    .slice(0, SEAT_WATCH_SIZE)
}
