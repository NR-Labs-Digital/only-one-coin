import { getTranslations, setRequestLocale } from 'next-intl/server'
import { listStudents } from '@/lib/backoffice/students'
import { getStaffSession } from '@/lib/backoffice/session'
import {
  canBrowseStudents,
  canCreateStudent,
} from '@/lib/backoffice/permissions'
import { EmptyState, PageHeader } from '@/components/backoffice/ui'
import { StudentsTable } from './students-table'

/**
 * Student directory. The list itself is a client component so search and the
 * status filter work without a backend; the data still comes from the server.
 */
export default async function StudentsPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('bo')

  const staff = await getStaffSession()

  /* A teacher reaches a student through their own class group, never through a
     roster of everybody in the institution. The screen says so; the check that
     enforces it is the role on the route in `apps/api` (CLAUDE.md §8). */
  if (!canBrowseStudents(staff.role)) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader title={t('students.title')} />
        <EmptyState
          icon="shield"
          title={t('students.locked_title')}
          body={t('students.locked_body')}
        />
      </div>
    )
  }

  const page = await listStudents()

  /* API down or erroring. An honest failure screen, never an empty
     directory — "no students" and "could not load" are different facts. */
  if (!page) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader title={t('students.title')} />
        <EmptyState
          icon="alert"
          title={t('students.load_error_title')}
          body={t('students.load_error_body')}
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t('students.title')} />
      <StudentsTable
        rows={page.items}
        initialNextCursor={page.nextCursor}
        canCreate={canCreateStudent(staff.role)}
      />
    </div>
  )
}
