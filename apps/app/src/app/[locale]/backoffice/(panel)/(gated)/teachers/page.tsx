import { getTranslations, setRequestLocale } from 'next-intl/server'
import { redirect } from '@/i18n/navigation'
import {
  listCourses,
  listTeachers,
} from '@/lib/backoffice/mock-data'
import { getStaffSession } from '@/lib/backoffice/session'
import {
  canCreateTeacher,
  canManageTeachers,
  isRestrictedToOwnClassGroups,
} from '@/lib/backoffice/permissions'
import type { CourseLanguage } from '@/lib/backoffice/types'
import { EmptyState, PageHeader } from '@/components/backoffice/ui'
import { TeachersView } from './teachers-view'

/**
 * Teacher roster (`docs/REQUISITOS.md` RF03): who can teach what, who is free,
 * and who still owes a grade or a certificate.
 *
 * The list is a client component so search and filters work with no backend;
 * the data and the role gates come from the server. Hiding the roster from a
 * teacher and the "new teacher" button from coordination are screen
 * conveniences — the enforcing check is the role declared on the route in
 * `apps/api` (CLAUDE.md §8).
 */
export default async function TeachersPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('bo')

  const staff = await getStaffSession()

  /* A teacher has no roster — they have a ficha. Sending them to their own is
     the honest answer to "Docentes" in their sidebar; the id comes from the
     session, never from the URL (CLAUDE.md §8). */
  if (isRestrictedToOwnClassGroups(staff.role) && staff.teacherId) {
    redirect({ href: `/backoffice/teachers/${staff.teacherId}`, locale })
  }

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

  /* The languages a teacher may be cleared for are the catalog's, not a list of
     their own: a new language is a course row, never a code branch
     (CLAUDE.md §1). */
  const languages = [
    ...new Map(
      listCourses().map((course) => [course.language.id, course.language]),
    ).values(),
  ].sort((a, b) => a.name.localeCompare(b.name)) satisfies CourseLanguage[]

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t('teachers.title')} />
      <TeachersView
        rows={listTeachers()}
        languages={languages}
        canCreate={canCreateTeacher(staff.role)}
      />
    </div>
  )
}
