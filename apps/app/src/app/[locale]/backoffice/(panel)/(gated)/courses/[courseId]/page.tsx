import { notFound } from 'next/navigation'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { getCatalogCourse, listCatalogCourses } from '@/lib/backoffice/catalog'
import { getStaffSession } from '@/lib/backoffice/session'
import {
  canBrowseCatalog,
  canConfigureCourse,
  canCreateCourse,
  canManagePrices,
  canRetireCatalogEntry,
} from '@/lib/backoffice/permissions'
import { BoIcon } from '@/components/backoffice/icons'
import { StatusBadge } from '@/components/backoffice/ui'
import { CourseOptionsForm } from '../course-options-form'
import { CoursePlans } from '../course-plans'

/**
 * One course: its plans and prices, and its options. A page of its own, not a
 * pair of side panels stacked over the list (OOC-126): the plans panel opened
 * from a button inside the options panel, and the options' Save — which never
 * touched a plan — was where staff looked for the price they had just changed.
 *
 * Plans come first: the money is what this page is opened for most.
 */
export default async function CourseDetailPage({
  params,
}: {
  params: Promise<{ locale: string; courseId: string }>
}) {
  const { locale, courseId } = await params
  setRequestLocale(locale)
  const t = await getTranslations('bo')

  const staff = await getStaffSession()
  if (!canBrowseCatalog(staff.role)) notFound()

  const [detail, courses] = await Promise.all([getCatalogCourse(courseId), listCatalogCourses()])
  if (!detail) notFound()
  const { course, plans } = detail
  const catalog = courses ?? [course]
  const languages = [...new Map(catalog.map((row) => [row.language.id, row.language])).values()]
  const canConfigure = canConfigureCourse(staff.role)

  return (
    <div className="flex flex-col gap-5">
      <Link
        href="/backoffice/courses"
        className="inline-flex w-fit items-center gap-1.5 text-sm font-semibold text-muted-foreground transition hover:text-ink"
      >
        <BoIcon name="arrow-left" size={16} />
        {t('courses.back_to_list')}
      </Link>

      <header className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h1 className="text-xl font-semibold tracking-tight text-ink sm:text-2xl">{course.name}</h1>
        {!course.active ? (
          <StatusBadge tone="neutral" label={t('courses.inactive')} />
        ) : (
          !course.hasPriceInForce && (
            <StatusBadge
              tone="warning"
              label={t('courses.no_price_badge')}
              title={t('courses.no_price_hint')}
            />
          )
        )}
        <p className="basis-full text-sm text-muted-foreground">
          {[course.language.name, course.level].filter(Boolean).join(' · ')}
        </p>
      </header>

      <div
        className={`grid items-start gap-5 ${canConfigure ? '@4xl/page:grid-cols-2' : 'max-w-2xl'}`}
      >
        <div id="plans" className="scroll-mt-20">
          <CoursePlans
            courseId={course.id}
            plans={plans}
            canManage={canManagePrices(staff.role)}
            canRetire={canRetireCatalogEntry(staff.role)}
          />
        </div>
        {canConfigure && (
          <CourseOptionsForm
            course={course}
            courses={catalog}
            languages={languages}
            canEditIdentity={canCreateCourse(staff.role)}
          />
        )}
      </div>
    </div>
  )
}
