import { getTranslations } from 'next-intl/server'
import { SectionTabs } from '@/components/backoffice/section-tabs'
import { listPendingTeacherClassGroups } from '@/lib/backoffice/catalog'
import { listGradeRegisters } from '@/lib/backoffice/grade-registers'
import { getStaffSession } from '@/lib/backoffice/session'
import { canReadGrades } from '@/lib/backoffice/permissions'

/**
 * The Académico section's tabs: class groups, the ones still waiting for a
 * teacher (OOC-97), the teachers' calendar (OOC-99), courses and the language list the courses are filed under
 * (OOC-128). One copy, so the pages never disagree on the strip.
 *
 * The pending tab carries its count on every page of the section — it is a
 * to-do list, and a number nobody sees until they open the tab does not get
 * the list worked. A failed read just drops the number. The grade registers
 * tab (OOC-180) is only for who reads grades, and counts the registers
 * waiting for coordination's review.
 */
export async function AcademicTabs() {
  const t = await getTranslations('bo')
  const staff = await getStaffSession()
  const readsGrades = canReadGrades(staff)
  const [pending, registers] = await Promise.all([
    listPendingTeacherClassGroups(),
    readsGrades ? listGradeRegisters({ status: 'in_review' }) : Promise.resolve(null),
  ])
  return (
    <SectionTabs
      tabs={[
        { href: '/backoffice/class-groups', label: t('class_groups.title') },
        {
          href: '/backoffice/pending-class-groups',
          label: t('class_groups.pending_tab'),
          count: pending?.length,
        },
        ...(readsGrades
          ? [
              {
                href: '/backoffice/grade-registers',
                label: t('grade_register.tab'),
                count: registers?.items.length,
              },
            ]
          : []),
        { href: '/backoffice/teacher-calendar', label: t('teacher_calendar.tab') },
        { href: '/backoffice/courses', label: t('courses.title') },
        { href: '/backoffice/languages', label: t('languages.title') },
      ]}
    />
  )
}
