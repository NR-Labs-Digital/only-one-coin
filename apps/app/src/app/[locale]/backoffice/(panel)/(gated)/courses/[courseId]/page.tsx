import { notFound } from 'next/navigation'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { getCatalogCourse, listCatalogCourses, listCatalogLanguages } from '@/lib/backoffice/catalog'
import { getStaffSession } from '@/lib/backoffice/session'
import {
  canBrowseCatalog,
  canConfigureCourse,
  canCreateCourse,
  canEditCourseIdentity,
  canManagePrices,
  canRetireCatalogEntry,
} from '@/lib/backoffice/permissions'
import { BoIcon } from '@/components/backoffice/icons'
import { HelpHint } from '@/components/backoffice/help-hint'
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
  searchParams: Promise<{ tab?: string; created?: string }>
}) {
  const { locale, courseId } = await params
  const { tab: requested, created } = await searchParams
  const tab: CourseTab = TABS.includes(requested as CourseTab) ? (requested as CourseTab) : 'plans'
  setRequestLocale(locale)
  const t = await getTranslations('bo')

  const staff = await getStaffSession()
  if (!canBrowseCatalog(staff)) notFound()

  const [detail, courses, languageList] = await Promise.all([
    getCatalogCourse(courseId),
    listCatalogCourses(),
    listCatalogLanguages(),
  ])
  if (!detail) notFound()
  const { course, plans } = detail
  const catalog = courses ?? [course]
  const languages = languageList ?? []
  const canConfigure = canConfigureCourse(staff)
  const canRetire = canRetireCatalogEntry(staff)
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
        {/* One (?) for every badge the header can wear, the same one as the
            status column of the course list. */}
        {(!course.active || !course.hasPriceInForce || course.missingModuleMaterials) && (
          <HelpHint what={t('help.acad_course_status_what')} how={t('help.acad_course_status_how')} />
        )}
        {canCreateCourse(staff) && (
          // Opens the new-course form filled in from this one (OOC-182); nothing is written until it is saved.
          <span className="inline-flex items-center gap-1 sm:ml-auto">
            <Link
              href={`/backoffice/courses/${course.id}/duplicate`}
              className="inline-flex min-h-tap items-center gap-1.5 rounded-lg border border-line px-3.5 py-2 text-sm font-semibold text-muted-foreground transition hover:text-ink"
            >
              <BoIcon name="copy" size={16} />
              {t('courses.duplicate')}
            </Link>
            <HelpHint what={t('help.course_duplicate_what')} how={t('help.course_duplicate_how')} />
          </span>
        )}
        <p className="basis-full text-sm text-muted-foreground">
          {[course.language.name, course.level].filter(Boolean).join(' · ')}
        </p>
        {created === 'duplicate' && (
          <p role="status" className="basis-full text-sm text-emerald-700">
            {t('courses.duplicated')}
          </p>
        )}
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
            canManage={canManagePrices(staff)}
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
              canEditIdentity={canEditCourseIdentity(staff)}
            />
          )}
          {canRetire && <CourseRetire courseId={course.id} active={course.active} />}
        </div>
      )}
    </div>
  )
}
