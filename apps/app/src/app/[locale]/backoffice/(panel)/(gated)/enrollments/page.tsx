import { getTranslations, setRequestLocale } from 'next-intl/server'
import { listEnrollments, parseEnrollmentLedgerQuery } from '@/lib/backoffice/enrollments'
import { getStudent } from '@/lib/backoffice/students'
import { getStaffSession } from '@/lib/backoffice/session'
import {
  canCreateEnrollment,
  canManageEnrollment,
  canFreezeEnrollment,
  canTransferEnrollment,
  canBrowseEnrollments,
} from '@/lib/backoffice/permissions'
import { EmptyState, PageHeader } from '@/components/backoffice/ui'
import { EnrollmentsView, type EnrollmentPreselect } from './enrollments-view'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** One value of a search param, only if it is an id worth asking the API about. */
function idParam(value: string | string[] | undefined): string | null {
  const first = Array.isArray(value) ? value[0] : value
  return first && UUID.test(first) ? first : null
}

/**
 * `?student=&classGroup=` — the waitlist's "enroll the first in line" link.
 * The student is read from the API (a link carries an id, never a name to
 * trust); the class group is only a hint the form checks against the open list
 * the server sends. Neither carries a price: that stays the plan price in force
 * (CLAUDE.md §1). Anything unreadable is dropped, and the form opens as usual.
 */
async function readPreselect(
  params: Record<string, string | string[] | undefined>,
): Promise<EnrollmentPreselect | null> {
  const studentId = idParam(params.student)
  const classGroupId = idParam(params.classGroup)
  if (!studentId && !classGroupId) return null
  const student = studentId ? await getStudent(studentId).catch(() => null) : null
  return {
    student: student
      ? {
          id: student.id,
          firstName: student.firstName,
          lastName: student.lastName,
          nationalIdType: student.nationalIdType,
          nationalId: student.nationalId,
        }
      : null,
    classGroupId,
  }
}

/**
 * Matrículas — every seat in the institution, in one list. Until now an
 * enrollment could only be read from inside the student it belongs to, which
 * answers "what did this person buy" and never "who is sitting in Inglés A1
 * this ciclo".
 *
 * Only confirmed seats are listed: a reservation is still a payment matter
 * and lives in the payments section until the payment is settled.
 *
 * Search, filters and paging live in the URL and run in Postgres: this server
 * component reads them from `searchParams` and fetches exactly the page asked
 * for. The client component only rewrites the URL. Hiding the create
 * button is a screen convenience — the enforcing check is the role declared on
 * the route in `apps/api` (CLAUDE.md §8).
 */
export default async function EnrollmentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('bo')

  const staff = await getStaffSession()

  /* Enrollments belong to administration and coordination
     (`docs/ARCHITECTURE.md` §3). Tesorería settles the money in the payments
     section and a teacher reaches their students through the class group —
     neither reads a roster of the whole institution. The screen says so; the
     role on the route in `apps/api` is what enforces it (CLAUDE.md §8). */
  if (!canBrowseEnrollments(staff)) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader
          title={t('enrollments.title')}
        />
        <EmptyState
          icon="shield"
          title={t('enrollments.locked_title')}
          body={t('enrollments.locked_body')}
        />
      </div>
    )
  }

  /* The ledger comes from `apps/api` (GET /enrollments). A failure is shown as
     a failure: an empty table would read as "nobody enrolled this ciclo",
     which is the one thing this screen must never say by accident. */
  const search = await searchParams
  const query = parseEnrollmentLedgerQuery(search)
  const canCreate = canCreateEnrollment(staff)
  const [ledger, preselect] = await Promise.all([
    listEnrollments(query),
    canCreate ? readPreselect(search) : Promise.resolve(null),
  ])

  if (!ledger) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader title={t('enrollments.title')} />
        <EmptyState
          icon="alert"
          title={t('enrollments.load_error_title')}
          body={t('enrollments.load_error_body')}
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={t('enrollments.title')}
      />
      <EnrollmentsView
        ledger={ledger}
        query={query}
        canCreate={canCreate}
        canMove={canManageEnrollment(staff)}
        canFreeze={canFreezeEnrollment(staff)}
        canTransfer={canTransferEnrollment(staff)}
        preselect={preselect}
      />
    </div>
  )
}
