import { getTranslations, setRequestLocale } from 'next-intl/server'
import { listCatalogLanguages } from '@/lib/backoffice/catalog'
import { listTeachers, parseTeacherDirectoryQuery, toLanguage } from '@/lib/backoffice/teachers'
import { listClassroomAccounts } from '@/lib/backoffice/classroom-accounts'
import { getStaffSession } from '@/lib/backoffice/session'
import {
  canCreateTeacher,
  canManageTeachers,
  canViewClassroomAccounts,
} from '@/lib/backoffice/permissions'
import { EmptyState, PageHeader } from '@/components/backoffice/ui'
import { BoIcon } from '@/components/backoffice/icons'
import { Link } from '@/i18n/navigation'
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

  if (!canManageTeachers(staff)) {
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
  const [directory, languageList, classroomAccounts] = await Promise.all([
    listTeachers(query),
    listCatalogLanguages(),
    canViewClassroomAccounts(staff) ? listClassroomAccounts() : Promise.resolve(null),
  ])

  /* API down or erroring. An honest failure screen, never an empty roster —
     "no teachers" and "could not load" are different facts. */
  if (!directory || !languageList) {
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

  /* The languages a teacher may be cleared for are the language list's
     (OOC-128): a new language is a row there, never a code branch
     (CLAUDE.md §1). */
  const languages = languageList.map((language) => toLanguage(language.name))

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={t('teachers.title')}
        actions={
          canViewClassroomAccounts(staff) ? (
            <Link
              href="/backoffice/teachers/classroom-accounts"
              className="inline-flex min-h-tap items-center gap-1.5 rounded-lg border border-line bg-white px-3.5 py-2 text-sm font-semibold text-ink transition hover:bg-cream"
            >
              <BoIcon name="key" size={16} />
              {t('classroom_accounts.title')}
            </Link>
          ) : undefined
        }
      />
      <TeachersView
        directory={directory}
        query={query}
        languages={languages}
        canCreate={canCreateTeacher(staff)}
        classroomAccounts={classroomAccounts}
      />
    </div>
  )
}
