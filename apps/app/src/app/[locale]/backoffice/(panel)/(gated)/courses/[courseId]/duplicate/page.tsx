import { notFound } from 'next/navigation'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { getCatalogCourse, listCatalogCourses, listCatalogLanguages } from '@/lib/backoffice/catalog'
import { getStaffSession } from '@/lib/backoffice/session'
import { canCreateCourse } from '@/lib/backoffice/permissions'
import { BoIcon } from '@/components/backoffice/icons'
import { DuplicateCourse } from './duplicate-course'

/**
 * "Duplicar curso" (OOC-182): the new-course form, filled in from this one.
 * Whoever opens a course duplicates one — the screen gate mirrors
 * `catalog.courses_create` on the route, which is the check that counts.
 */
export default async function DuplicateCoursePage({
  params,
}: {
  params: Promise<{ locale: string; courseId: string }>
}) {
  const { locale, courseId } = await params
  setRequestLocale(locale)
  const t = await getTranslations('bo')

  const staff = await getStaffSession()
  if (!canCreateCourse(staff)) notFound()

  const [detail, courses, languages] = await Promise.all([
    getCatalogCourse(courseId),
    listCatalogCourses(),
    listCatalogLanguages(),
  ])
  if (!detail) notFound()

  return (
    <div className="flex flex-col gap-5">
      <Link
        href={`/backoffice/courses/${detail.course.id}`}
        className="inline-flex w-fit items-center gap-1.5 text-sm font-semibold text-muted-foreground transition hover:text-ink"
      >
        <BoIcon name="arrow-left" size={16} />
        {t('courses.duplicate_back', { name: detail.course.name })}
      </Link>
      <DuplicateCourse source={detail} courses={courses ?? [detail.course]} languages={languages ?? []} />
    </div>
  )
}
