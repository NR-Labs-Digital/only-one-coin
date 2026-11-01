import { notFound } from 'next/navigation'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { getCatalogCourse, listCatalogCourses, listCatalogLanguages } from '@/lib/backoffice/catalog'
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
import { tabClass, tabStripClass } from '@/components/backoffice/tab-strip'
import { CourseOptionsForm } from '../course-options-form'
import { CoursePlans } from '../course-plans'
import { CoursePriceHistory } from '../course-price-history'
import { CourseRetire } from '../course-retire'

const TABS = ['plans', 'history', 'settings'] as const
type CourseTab = (typeof TABS)[number]

/**
 * One course: its plans and prices, and its options. A page of its own, not a
 * pair of side panels stacked over the list (OOC-126): the plans panel opened
 * from a button inside the options panel, and the options' Save — which never
 * touched a plan — was where staff looked for the price they had just changed.
 *
 * Plans come first: the money is what this page is opened for most.
 *
 * One thing per tab (28/10/2026): the plans and the price in force; every
 * price each plan ever had; and the course's options together with taking it
 * off the catalog. Stacked on one screen, a plan's dozens of past prices
 * buried the one that matters. The tab is in the URL, so a link to the
 * history is a link.
 */
export default async function CourseDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; courseId: string }>
  searchParams: Promise<{ tab?: string }>
}) {
  const { locale, courseId } = await params
  const requested = (await searchParams).tab
  const tab: CourseTab = TABS.includes(requested as CourseTab) ? (requested as CourseTab) : 'plans'
  setRequestLocale(locale)
  const t = await getTranslations('bo')

  const staff = await getStaffSession()
  if (!canBrowseCatalog(staff.role)) notFound()

  const [detail, courses, languageList] = await Promise.all([
    getCatalogCourse(courseId),
    listCatalogCourses(),
    listCatalogLanguages(),
  ])
  if (!detail) notFound()
  const { course, plans } = detail
  const catalog = courses ?? [course]
  const languages = languageList ?? []
  const canConfigure = canConfigureCourse(staff.role)
  const canRetire = canRetireCatalogEntry(staff.role)
  const tabs = TABS.filter((item) => item !== 'settings' || canConfigure || canRetire)

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
          <>
            {!course.hasPriceInForce && (
              <StatusBadge
                tone="warning"
                label={t('courses.no_price_badge')}
                title={t('courses.no_price_hint')}
              />
            )}
            {course.missingModuleMaterials && (
              <StatusBadge
                tone="warning"
                label={t('courses.no_material_badge')}
                title={t('courses.no_material_hint')}
              />
            )}
          </>
        )}
        <p className="basis-full text-sm text-muted-foreground">
          {[course.language.name, course.level].filter(Boolean).join(' · ')}
        </p>
      </header>

      <nav className={tabStripClass}>
        {tabs.map((item) => (
          <Link
            key={item}
            href={item === 'plans' ? `/backoffice/courses/${course.id}` : `/backoffice/courses/${course.id}?tab=${item}`}
            aria-current={item === tab ? 'page' : undefined}
            className={tabClass(item === tab)}
          >
            {t(`courses.tab_${item}`)}
          </Link>
        ))}
      </nav>

      {tab === 'plans' && (
        <div id="plans" className="scroll-mt-20">
          <CoursePlans
            courseId={course.id}
            plans={plans}
            canManage={canManagePrices(staff.role)}
            canRetire={canRetire}
          />
        </div>
      )}

      {tab === 'history' && <CoursePriceHistory plans={plans} />}

      {tab === 'settings' && tabs.includes('settings') && (
        // Options on the wide side, taking the course off the catalog beside
        // them: a split the column decides, not the window (apps/app/CLAUDE.md).
        <div className="grid items-start gap-5 @4xl/page:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          {canConfigure && (
            <CourseOptionsForm
              course={course}
              courses={catalog}
              languages={languages}
              canEditIdentity={canCreateCourse(staff.role)}
            />
          )}
          {canRetire && <CourseRetire courseId={course.id} active={course.active} />}
        </div>
      )}
    </div>
  )
}
