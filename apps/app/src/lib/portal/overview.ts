import type {
  Enrollment,
  NextClassOccurrence,
  Payment,
  PaymentMethod,
  PaymentStatus,
  SeatStatus,
  Student,
  WeeklySlot,
} from './types'
import { parseClassLink } from '@/lib/backoffice/class-links'

/**
 * `GET /portal/overview` as the API sends it (apps/api,
 * `GetPortalOverviewRoute`) and the mapping to the shapes the portal screens
 * render. Pure — no fetch here — so the mapping reads on its own.
 */

type ApiWeekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'

interface ApiPayment {
  id: string
  amountCents: number
  currency: 'PEN'
  method: PaymentMethod
  methodDetail: string | null
  status: PaymentStatus
  operationNumber: string | null
  submittedAt: string
  settledAt: string | null
  hasReceipt: boolean
}

interface ApiEnrollment {
  id: string
  code: string
  status: 'under_review' | 'active' | 'completed' | 'rejected'
  seatStatus: SeatStatus
  createdAt: string
  course: {
    name: string
    summary: string
    level: string
    minAge: number
    requiresCertificationExam: boolean
  }
  classGroup: {
    name: string
    teacherName: string
    slots: { weekday: ApiWeekday; startTime: string; endTime: string }[]
    startsOn: string | null
    endsOn: string | null
    classroomUrl: string | null
  }
  academicPeriodName: string
  plan: { name: string; priceId: string; priceCents: number; currency: 'PEN' }
  payments: ApiPayment[]
}

export interface OverviewResponse {
  student: Student
  enrollments: ApiEnrollment[]
}

/** The API's weekday code → the portal's `weekday_short.<n>` index (0 = Sunday). */
const WEEKDAY_INDEX: Record<ApiWeekday, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
}

/**
 * What the student is told about a payment. `pending` and `under_review` are
 * one state from their side — the receipt went in and a person has not
 * decided yet — so both read as `under_review`. "Pending" beside money they
 * already sent reads as "pay again"; and the split itself is the traffic
 * light's verdict (apps/api, Semáforo), which is the reviewer's, not theirs.
 */
function toPayment(p: ApiPayment): Payment {
  return { ...p, status: p.status === 'pending' ? 'under_review' : p.status }
}

export function toEnrollment(row: ApiEnrollment): Enrollment {
  const payments = row.payments.map(toPayment)
  return {
    id: row.id,
    code: row.code,
    status: row.status,
    seatStatus: row.seatStatus,
    createdAt: row.createdAt,
    course: { ...row.course, materials: [] },
    classGroup: {
      name: row.classGroup.name,
      teacherName: row.classGroup.teacherName,
      schedule: row.classGroup.slots.map(
        (slot): WeeklySlot => ({
          weekday: WEEKDAY_INDEX[slot.weekday],
          startTime: slot.startTime,
          endTime: slot.endTime,
        }),
      ),
      startDate: row.classGroup.startsOn,
      endDate: row.classGroup.endsOn,
      // Re-checked before it becomes an href: only a Classroom link opens.
      classroomUrl: row.classGroup.classroomUrl
        ? parseClassLink(row.classGroup.classroomUrl, 'classroom') || null
        : null,
    },
    plan: { name: row.plan.name, priceCents: row.plan.priceCents, currency: row.plan.currency },
    academicPeriod: { name: row.academicPeriodName },
    // Monthly billing, modules, the class-access lock, grades and progress
    // have no backend yet (OOC-86, OOC-94/85, OOC-102): every enrollment is
    // a package, unlocked, with nothing to draw a bar from.
    billingMode: 'package',
    monthly: null,
    modules: [],
    payments,
    classAccessLock: null,
    finalGrade: null,
    progressPct: null,
  }
}

/**
 * Peru keeps UTC−5 all year (no daylight saving since 1994), so a class time
 * in America/Lima is a fixed offset from UTC.
 */
const LIMA_OFFSET_MS = -5 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

/** The calendar day an instant falls on in Lima, as UTC midnight of that day. */
function limaDay(instant: Date): number {
  const shifted = instant.getTime() + LIMA_OFFSET_MS
  return shifted - (((shifted % DAY_MS) + DAY_MS) % DAY_MS)
}

/** `"HH:mm"` in Lima on a Lima day → the UTC instant. */
function limaInstant(day: number, hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return day + ((h ?? 0) * 60 + (m ?? 0)) * 60 * 1000 - LIMA_OFFSET_MS
}

/**
 * The next class of an active enrollment, from the class group's weekly slots
 * and its dates — the calendar the coordination set, not a guess. A class
 * that is running right now still counts (its end is in the future), so the
 * student who opens the portal five minutes late still finds it. Enrollments
 * under review never get one: the seat is not theirs yet.
 */
export function nextClassOf(enrollments: Enrollment[], now: Date): NextClassOccurrence | null {
  let best: { at: number; enrollment: Enrollment } | null = null

  for (const enrollment of enrollments) {
    const { startDate, endDate, schedule } = enrollment.classGroup
    if (enrollment.status !== 'active' || !startDate || !endDate || schedule.length === 0) continue

    const firstDay = limaDay(new Date(startDate))
    const lastDay = limaDay(new Date(endDate))
    const fromDay = Math.max(firstDay, limaDay(now))

    // One week ahead is enough: every slot recurs within seven days.
    for (let day = fromDay; day <= lastDay && day < fromDay + 7 * DAY_MS; day += DAY_MS) {
      const weekday = new Date(day).getUTCDay()
      for (const slot of schedule) {
        if (slot.weekday !== weekday) continue
        if (limaInstant(day, slot.endTime) <= now.getTime()) continue
        const at = limaInstant(day, slot.startTime)
        if (!best || at < best.at) best = { at, enrollment }
      }
    }
  }

  if (!best) return null
  const { enrollment } = best
  return {
    enrollmentId: enrollment.id,
    courseName: enrollment.course.name,
    classGroupName: enrollment.classGroup.name,
    teacherName: enrollment.classGroup.teacherName,
    startsAt: new Date(best.at).toISOString(),
    classroomUrl: enrollment.classGroup.classroomUrl,
    classAccessLock: enrollment.classAccessLock,
  }
}

/** The payment that speaks for the enrollment now — the newest. */
export function currentPayment(enrollment: Enrollment): Payment | null {
  return enrollment.payments[0] ?? null
}
