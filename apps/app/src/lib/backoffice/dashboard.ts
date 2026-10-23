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
  (): Promise<PaymentReviewQueue | null> => listPaymentReviewQueue({ page: 1, q: '', sort: 'priority' }),
)

/** How many class groups the home shows under seat pressure. */
export const SEAT_WATCH_SIZE = 6

/** On sale right now: taking enrollments, and neither it nor its course retired. */
function onSale(group: ClassGroupItem): boolean {
  return group.status === 'enrolling' && group.active && group.courseActive
}

/** Seats taken over capacity across every class group on sale. */
export function seatOccupancy(groups: ClassGroupItem[]): { taken: number; capacity: number } {
  return groups.filter(onSale).reduce(
    (total, group) => ({
      taken: total.taken + group.seatsTaken,
      capacity: total.capacity + group.capacity,
    }),
    { taken: 0, capacity: 0 },
  )
}

/** The class groups on sale closest to full; the earliest start breaks a tie. */
export function seatsUnderPressure(groups: ClassGroupItem[]): ClassGroupItem[] {
  const fill = (group: ClassGroupItem) =>
    group.capacity === 0 ? 0 : group.seatsTaken / group.capacity
  return groups
    .filter(onSale)
    .sort(
      (a, b) =>
        fill(b) - fill(a) || (a.startsOn ?? '').localeCompare(b.startsOn ?? ''),
    )
    .slice(0, SEAT_WATCH_SIZE)
}

/** Whole hours the oldest open payment has been waiting; `null` on an empty queue. */
export function oldestWaitHours(queue: PaymentReviewQueue, now: Date = new Date()): number | null {
  const oldest = queue.items[0]
  if (!oldest) return null
  return Math.max(0, Math.floor((now.getTime() - new Date(oldest.submittedAt).getTime()) / 3_600_000))
}
