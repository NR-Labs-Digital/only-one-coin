import { getTranslations } from 'next-intl/server'
import { SectionTabs } from '@/components/backoffice/section-tabs'
import { listPendingTeacherClassGroups } from '@/lib/backoffice/catalog'

/**
 * The Académico section's tabs: class groups, the ones still waiting for a
 * teacher (OOC-97), the teachers' calendar (OOC-99), courses and the language list the courses are filed under
 * (OOC-128). One copy, so the pages never disagree on the strip.
 *
 * The pending tab carries its count on every page of the section — it is a
 * to-do list, and a number nobody sees until they open the tab does not get
 * the list worked. A failed read just drops the number.
 */
export async function AcademicTabs() {
  const t = await getTranslations('bo')
  const pending = await listPendingTeacherClassGroups()
  return (
    <SectionTabs
      tabs={[
        { href: '/backoffice/class-groups', label: t('class_groups.title') },
        {
          href: '/backoffice/pending-class-groups',
          label: t('class_groups.pending_tab'),
          count: pending?.length,
        },
        { href: '/backoffice/teacher-calendar', label: t('teacher_calendar.tab') },
        { href: '/backoffice/courses', label: t('courses.title') },
        { href: '/backoffice/languages', label: t('languages.title') },
      ]}
    />
  )
}
