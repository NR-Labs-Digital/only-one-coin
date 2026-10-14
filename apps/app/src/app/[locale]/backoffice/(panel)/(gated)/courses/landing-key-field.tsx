'use client'

import { useTranslations } from 'next-intl'
import {
  LANDING_COURSE_KEYS,
  type LandingCourseKey,
} from '@ooc/domain/landing-course-keys'
import type { CourseRow } from '@/lib/backoffice/types'

const fieldClass =
  'rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink outline-none transition focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/15'

const labelClass =
  'text-xs font-medium uppercase tracking-wide text-muted-foreground'

/** Live courses already answering to a key — one per key (OOC-117). */
export function landingKeyHolders(courses: CourseRow[]): Map<LandingCourseKey, CourseRow> {
  const holders = new Map<LandingCourseKey, CourseRow>()
  for (const course of courses) {
    if (course.active && course.landingKey) holders.set(course.landingKey, course)
  }
  return holders
}

/**
 * Which landing page's enroll button opens the checkout on this course
 * (OOC-117). The landing is static and sends the key, never an id — so the
 * link survives a course being recreated, as long as somebody links the new
 * one here. A key another live course holds is shown but not offered: the API
 * refuses it anyway, and the reader should see who has it.
 */
export function LandingKeyField({
  value,
  onChange,
  courses,
  selfId,
}: {
  value: LandingCourseKey | null
  onChange: (next: LandingCourseKey | null) => void
  courses: CourseRow[]
  /** The course being edited — its own key is not "taken". */
  selfId?: string
}) {
  const t = useTranslations('bo')
  const holders = landingKeyHolders(courses)

  return (
    <label className="flex flex-col gap-1">
      <span className={labelClass}>{t('landing_key.label')}</span>
      <select
        value={value ?? ''}
        onChange={(event) => onChange((event.target.value || null) as LandingCourseKey | null)}
        className={fieldClass}
      >
        <option value="">{t('landing_key.none')}</option>
        {LANDING_COURSE_KEYS.map((key) => {
          const holder = holders.get(key)
          const taken = holder !== undefined && holder.id !== selfId
          return (
            <option key={key} value={key} disabled={taken}>
              {taken
                ? t('landing_key.taken_by', { page: t(`landing_key.pages.${key}`), course: holder.name })
                : t(`landing_key.pages.${key}`)}
            </option>
          )
        })}
      </select>
      <span className="text-xs text-muted-foreground">{t('landing_key.hint')}</span>
    </label>
  )
}
