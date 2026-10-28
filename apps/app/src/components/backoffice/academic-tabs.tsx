import { getTranslations } from 'next-intl/server'
import { SectionTabs } from '@/components/backoffice/section-tabs'

/**
 * The Académico section's tabs: class groups, courses and the language list
 * the courses are filed under (OOC-128). One copy, so the three pages never
 * disagree on the strip.
 */
export async function AcademicTabs() {
  const t = await getTranslations('bo')
  return (
    <SectionTabs
      tabs={[
        { href: '/backoffice/class-groups', label: t('class_groups.title') },
        { href: '/backoffice/courses', label: t('courses.title') },
        { href: '/backoffice/languages', label: t('languages.title') },
      ]}
    />
  )
}
