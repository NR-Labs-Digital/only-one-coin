'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import type { LandingCourseKey } from '@ooc/domain/landing-course-keys'
import type {
  CatalogErrorKey,
  CourseLanguage,
  CourseOptions,
  CourseRow,
} from '@/lib/backoffice/types'
import { catalogWrite, setCatalogEntryOnOffer } from '@/lib/backoffice/catalog-client'
import { BoIcon } from '@/components/backoffice/icons'
import {
  LiveEnrollmentsNotice,
  useLiveEnrollments,
} from '@/components/backoffice/retire-confirmation'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { CourseOptionFields } from './course-option-fields'
import { LandingKeyField } from './landing-key-field'

const fieldClass =
  'rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink outline-none transition focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/15'

const labelClass = 'text-xs font-medium uppercase tracking-wide text-muted-foreground'

/** What only whoever may create a course may rewrite (`PATCH /catalog/courses/:id`). */
type IdentityDraft = { name: string; language: string; level: string; summary: string }

function identityDraft(course: CourseRow): IdentityDraft {
  return {
    name: course.name,
    language: course.language.name,
    level: course.level,
    summary: course.summary,
  }
}

/**
 * Course options — what coordination may change on a course that already
 * exists — and, for whoever may create a course, its identity: name,
 * language, level and summary (OOC-70). Renaming a course after class groups
 * hang off it rewrites what students enrolled in, so the identity goes
 * through the course route that only master/admin may call, never the options
 * one.
 *
 * Price is absent for the same reason it is absent from the course type: it is
 * versioned and never edited, and the enrollment freezes the version in force
 * (CLAUDE.md §5).
 *
 * The landing page link (OOC-117) follows the identity: it decides what the
 * public website sells.
 *
 * Unticking "in catalog" retires the course on save. Before that, the sheet
 * reads how many enrollments are still standing on it and says so (CLAUDE.md
 * §1, "avisa, não bloqueia").
 */
export function CourseOptionsSheet({
  course,
  courses,
  languages,
  canEditIdentity,
  onClose,
  onSaved,
  onOpenPlans,
}: {
  course: CourseRow | null
  /** The whole catalog — to tell which landing pages another course holds. */
  courses: CourseRow[]
  /** The languages in use — named under the language field, like on creation. */
  languages: CourseLanguage[]
  canEditIdentity: boolean
  onClose: () => void
  onSaved: (message: 'saved' | 'retired' | 'restored', liveEnrollments?: number) => void
  /** Clicking the row lands here, so plans must be one step away, not hidden behind another control. */
  onOpenPlans: (course: CourseRow) => void
}) {
  const t = useTranslations('bo')
  const [draft, setDraft] = useState<CourseOptions | null>(null)
  const [identity, setIdentity] = useState<IdentityDraft | null>(null)
  const [landingKey, setLandingKey] = useState<LandingCourseKey | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<CatalogErrorKey | null>(null)

  // The draft follows whichever course the sheet was opened on, and is thrown
  // away on close — a half-edited course must not leak into the next one.
  useEffect(() => {
    setError(null)
    setLandingKey(course?.landingKey ?? null)
    setIdentity(course && identityDraft(course))
    setDraft(
      course && {
        minAge: course.minAge,
        modules: course.modules,
        totalHours: course.totalHours,
        certificateRule: course.certificateRule,
        allowsFreeze: course.allowsFreeze,
        allowsTransfer: course.allowsTransfer,
        active: course.active,
      },
    )
  }, [course])

  const retiring = course !== null && course.active && draft?.active === false
  const live = useLiveEnrollments('course', course?.id ?? '', retiring)

  /** The identity fields that differ from the course, trimmed — what the PATCH carries. */
  function identityPatch(target: CourseRow, next: IdentityDraft): Partial<IdentityDraft> {
    const before = identityDraft(target)
    return Object.fromEntries(
      (Object.keys(next) as (keyof IdentityDraft)[])
        .map((key) => [key, next[key].trim()] as const)
        .filter(([key, value]) => value !== before[key]),
    )
  }

  // Name, language and level may change but not go blank (the API refuses
  // them too); the summary may — the portal hides "Sobre el curso" then.
  const identityReady =
    !canEditIdentity ||
    identity === null ||
    (identity.name.trim() !== '' && identity.language.trim() !== '' && identity.level.trim() !== '')

  async function save(target: CourseRow, next: CourseOptions) {
    setSaving(true)
    setError(null)
    const { active, ...options } = next
    const changed = (Object.keys(options) as (keyof typeof options)[]).filter(
      (key) => options[key] !== target[key],
    )
    if (changed.length > 0) {
      const patch = Object.fromEntries(changed.map((key) => [key, options[key]]))
      const result = await catalogWrite(`/courses/${target.id}/options`, 'PATCH', patch)
      if (!result.ok) {
        setSaving(false)
        setError(result.error)
        return
      }
    }
    if (canEditIdentity && identity) {
      const patch = {
        ...identityPatch(target, identity),
        ...(landingKey !== target.landingKey && { landingKey }),
      }
      if (Object.keys(patch).length > 0) {
        const result = await catalogWrite(`/courses/${target.id}`, 'PATCH', patch)
        if (!result.ok) {
          setSaving(false)
          setError(result.error)
          return
        }
      }
    }
    if (active !== target.active) {
      const result = await setCatalogEntryOnOffer('course', target.id, active ? 'restore' : 'retire')
      setSaving(false)
      if (!result.ok) {
        setError(result.error)
        return
      }
      onSaved(active ? 'restored' : 'retired', result.data.liveEnrollments)
      onClose()
      return
    }
    setSaving(false)
    onSaved('saved')
    onClose()
  }

  return (
    <Sheet
      open={course !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <SheetContent
        side="right"
        closeLabel={t('course_options.close')}
        className="w-full gap-0 overflow-y-auto bg-white p-0 sm:max-w-md"
      >
        {course && draft && identity && (
          <>
            <SheetHeader className="gap-2 border-b border-line p-5 pr-14">
              <SheetTitle className="text-base font-semibold text-ink">
                {course.name}
              </SheetTitle>
              <SheetDescription>
                {t('course_options.subtitle', { language: course.language.name })}
              </SheetDescription>
            </SheetHeader>

            <div className="flex flex-col gap-4 p-5">
              <p className="flex items-start gap-2 rounded-lg border border-dashed border-line bg-sky-soft px-3 py-2 text-xs text-muted-foreground">
                <BoIcon name="alert" size={14} className="mt-0.5 shrink-0" />
                {t('course_options.applies_forward')}
              </p>

              <button
                type="button"
                onClick={() => onOpenPlans(course)}
                className="flex min-h-tap items-center gap-2 rounded-lg border border-line px-3.5 py-2 text-left text-sm font-semibold text-ink transition hover:bg-sky-soft"
              >
                <BoIcon name="payments" size={16} className="shrink-0 text-muted-foreground" />
                <span className="flex-1">{t('courses.plans')}</span>
                <span
                  className={`text-xs font-normal ${course.hasPriceInForce ? 'text-muted-foreground' : 'text-amber-700'}`}
                >
                  {course.hasPriceInForce
                    ? t('courses.plan_count', { count: course.planCount })
                    : t('courses.no_price_badge')}
                </span>
              </button>

              {canEditIdentity && (
                <section className="flex flex-col gap-3 border-b border-line pb-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {t('course_options.identity_title')}
                  </p>
                  <label className="flex flex-col gap-1">
                    <span className={labelClass}>{t('courses.field_name')}</span>
                    <input
                      value={identity.name}
                      onChange={(event) => setIdentity({ ...identity, name: event.target.value })}
                      className={fieldClass}
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className={labelClass}>{t('courses.field_language')}</span>
                    <input
                      value={identity.language}
                      onChange={(event) => setIdentity({ ...identity, language: event.target.value })}
                      className={fieldClass}
                    />
                    {/* Courses group by the language's spelling — a typo here
                        moves the course into a fold of its own. */}
                    <span className="text-xs text-muted-foreground">
                      {t('courses.field_language_hint', {
                        languages: languages.map((item) => item.name).join(', '),
                      })}
                    </span>
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className={labelClass}>{t('courses.field_level')}</span>
                    <input
                      value={identity.level}
                      onChange={(event) => setIdentity({ ...identity, level: event.target.value })}
                      className={fieldClass}
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className={labelClass}>{t('course_options.summary')}</span>
                    <textarea
                      value={identity.summary}
                      rows={3}
                      onChange={(event) => setIdentity({ ...identity, summary: event.target.value })}
                      className={fieldClass}
                    />
                    <span className="text-xs text-muted-foreground">
                      {t('course_options.summary_hint')}
                    </span>
                  </label>
                  <p className="text-xs text-muted-foreground">{t('course_options.identity_hint')}</p>
                </section>
              )}

              <CourseOptionFields value={draft} onChange={setDraft} />

              {retiring && <LiveEnrollmentsNotice state={live} />}

              {canEditIdentity && (
                <LandingKeyField
                  value={landingKey}
                  onChange={setLandingKey}
                  courses={courses}
                  selfId={course.id}
                />
              )}

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={saving || !identityReady || (retiring && live.status === 'loading')}
                  onClick={() => void save(course, draft)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-brand-blue px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-brand-blue-deep disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-brand-blue"
                >
                  <BoIcon name="check" size={16} />
                  {t('course_options.save')}
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-lg border border-line px-3.5 py-2 text-sm font-semibold text-muted-foreground transition hover:text-ink"
                >
                  {t('course_options.cancel')}
                </button>
              </div>

              {error && (
                <p role="alert" className="text-sm text-red-700">
                  {t(`catalog_errors.${error}`)}
                </p>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
