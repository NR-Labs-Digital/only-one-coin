import { getTranslations, setRequestLocale } from 'next-intl/server'
import { listCatalogCourses } from '@/lib/backoffice/catalog'
import { listTeachers, parseTeacherDirectoryQuery, toLanguage } from '@/lib/backoffice/teachers'
import { getStaffSession } from '@/lib/backoffice/session'
import {
  canCreateTeacher,
  canManageTeachers,
} from '@/lib/backoffice/permissions'
import { EmptyState, PageHeader } from '@/components/backoffice/ui'
import { TeachersView } from './teachers-view'

/**
 * Teacher roster (`docs/REQUISITOS.md` RF03): who can teach what, who is free,
 * and whose contract needs chasing.
 *
 * Tab, search, filters and paging live in the URL and run in Postgres
 * (OOC-78): this server component reads them from `searchParams` and fetches
 * exactly the page asked for; the client view only rewrites the URL. Hiding
 * the roster from a teacher and the "new teacher" button from coordination are
 * screen conveniences — the enforcing check is the role declared on the route
 * in `apps/api` (CLAUDE.md §8).
 */
export default async function TeachersPage({
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

  if (!canManageTeachers(staff.role)) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader title={t('teachers.title')} />
        <EmptyState
          icon="shield"
          title={t('teachers.locked_title')}
          body={t('teachers.locked_body')}
        />
      </div>
    )
  }

  const query = parseTeacherDirectoryQuery(await searchParams)
  const [directory, courses] = await Promise.all([listTeachers(query), listCatalogCourses()])

  /* API down or erroring. An honest failure screen, never an empty roster —
     "no teachers" and "could not load" are different facts. */
  if (!directory || !courses) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader title={t('teachers.title')} />
        <EmptyState
          icon="alert"
          title={t('teachers.load_error_title')}
          body={t('teachers.load_error_body')}
        />
      </div>
    )
  }

  /* The languages a teacher may be cleared for are the catalog's, not a list of
     their own: a new language is a course row, never a code branch
     (CLAUDE.md §1). */
  const languages = [...new Set(courses.map((course) => course.language.name))]
    .sort((a, b) => a.localeCompare(b))
    .map(toLanguage)

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t('teachers.title')} />
      <TeachersView
        directory={directory}
        query={query}
        languages={languages}
        canCreate={canCreateTeacher(staff.role)}
      />
    </div>
  )
}
