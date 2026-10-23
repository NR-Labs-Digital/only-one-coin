'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import type { LandingCourseKey } from '@ooc/domain/landing-course-keys'
import type { CatalogErrorKey, CourseOptions, CourseRow } from '@/lib/backoffice/types'
import { catalogWrite } from '@/lib/backoffice/catalog-client'
import { BoIcon } from '@/components/backoffice/icons'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { CourseOptionFields } from './course-option-fields'
import { LandingKeyField } from './landing-key-field'

/**
 * Course options — what coordination may change on a course that already
 * exists. The name and the language are not here: renaming a course after
 * class groups hang off it rewrites what students enrolled in, and that
 * belongs to whoever may create one.
 *
 * Price is absent for the same reason it is absent from the course type: it is
 * versioned and never edited, and the enrollment freezes the version in force
 * (CLAUDE.md §5).
 *
 * The landing page link (OOC-117) shows only to whoever may create a course:
 * it decides what the public website sells, and it goes through the course's
 * identity route, not the options one.
 */
export function CourseOptionsSheet({
  course,
  courses,
  canLinkLanding,
  onClose,
  onSaved,
  onOpenPlans,
}: {
  course: CourseRow | null
  /** The whole catalog — to tell which landing pages another course holds. */
  courses: CourseRow[]
  canLinkLanding: boolean
  onClose: () => void
  onSaved: (message: 'saved' | 'retired' | 'restored', liveEnrollments?: number) => void
  /** Clicking the row lands here, so plans must be one step away, not hidden behind another control. */
  onOpenPlans: (course: CourseRow) => void
}) {
  const t = useTranslations('bo')
  const [draft, setDraft] = useState<CourseOptions | null>(null)
  const [landingKey, setLandingKey] = useState<LandingCourseKey | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<CatalogErrorKey | null>(null)

  // The draft follows whichever course the sheet was opened on, and is thrown
  // away on close — a half-edited course must not leak into the next one.
  useEffect(() => {
    setError(null)
    setLandingKey(course?.landingKey ?? null)
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
    if (canLinkLanding && landingKey !== target.landingKey) {
      const result = await catalogWrite(`/courses/${target.id}`, 'PATCH', { landingKey })
      if (!result.ok) {
        setSaving(false)
        setError(result.error)
        return
      }
    }
    if (active !== target.active) {
      const result = await catalogWrite<{ liveEnrollments: number }>(
        `/course/${target.id}/${active ? 'restore' : 'retire'}`,
        'POST',
      )
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
        {course && draft && (
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

              <CourseOptionFields value={draft} onChange={setDraft} />

              {canLinkLanding && (
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
                  disabled={saving}
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
