import { getTranslations, setRequestLocale } from 'next-intl/server'
import { listCourses } from '@/lib/backoffice/mock-data'
import { getStaffSession } from '@/lib/backoffice/session'
import { canConfigureCourse, canCreateCourse } from '@/lib/backoffice/permissions'
import { PageHeader } from '@/components/backoffice/ui'
import { SectionTabs } from '@/components/backoffice/section-tabs'
import { CoursesView } from './courses-view'

/**
 * Course catalog. A course is what a class group is an instance of
 * (`docs/REQUISITOS.md` RF09), so what changes here changes every class group
 * opened from it afterwards.
 *
 * Two different gates, on purpose: opening a course is an admin call, while
 * configuring one is coordination's day-to-day. Both are screen conveniences —
 * the enforcing check is the role declared on the route in `apps/api`
 * (CLAUDE.md §8).
 */
export default async function CoursesPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('bo')

  const staff = await getStaffSession()

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t('nav.academic')} />
      <SectionTabs
        tabs={[
          { href: '/backoffice/class-groups', label: t('class_groups.title') },
          { href: '/backoffice/courses', label: t('courses.title') },
        ]}
      />
      <CoursesView
        rows={listCourses()}
        canCreate={canCreateCourse(staff.role)}
        canConfigure={canConfigureCourse(staff.role)}
      />
    </div>
  )
}
