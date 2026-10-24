import { getTranslations, setRequestLocale } from 'next-intl/server'
import { listStudents, parseStudentDirectoryQuery } from '@/lib/backoffice/students'
import { getStaffSession } from '@/lib/backoffice/session'
import {
  canBrowseStudents,
  canCreateStudent,
  canExportStudents,
} from '@/lib/backoffice/permissions'
import { EmptyState, PageHeader } from '@/components/backoffice/ui'
import { StudentsTable } from './students-table'

/**
 * Student directory. Search, filters and paging live in the URL and run in
 * Postgres (OOC-76): this server component reads them from `searchParams` and
 * fetches exactly the page asked for; the client table only rewrites the URL.
 */
export default async function StudentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('bo')

  /* The directory is asked for alongside the session, not after it: every
     call to apps/api is a round trip, and the tab click waited for two in a
     row. A cargo that may not browse gets its 403 from the API and the
     answer is dropped — `listStudents` never rejects, so nothing is left
     floating. */
  const query = parseStudentDirectoryQuery(await searchParams)
  const pageRequest = listStudents(query)
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

  const page = await pageRequest

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
        directory={page}
        query={query}
        canCreate={canCreateStudent(staff.role)}
        canExport={canExportStudents(staff.role)}
      />
    </div>
  )
}
