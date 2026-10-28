'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import type { LandingCourseKey } from '@ooc/domain/landing-course-keys'
import type {
  CatalogErrorKey,
  CourseLanguage,
  CourseOptions,
  CourseRow,
} from '@/lib/backoffice/types'
import { catalogWrite } from '@/lib/backoffice/catalog-client'
import { moduleMaterialsPayload, moduleMaterialsReady } from '@/lib/backoffice/module-materials'
import { Card } from '@/components/backoffice/ui'
import { BoIcon } from '@/components/backoffice/icons'
import { CourseOptionFields, DEFAULT_COURSE_OPTIONS } from './course-option-fields'
import { AutoGrid } from '@/components/layout/auto-grid'
import { LandingKeyField } from './landing-key-field'

const fieldClass =
  'rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink outline-none transition focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/15'

const labelClass =
  'text-xs font-medium uppercase tracking-wide text-muted-foreground'

/**
 * Opening a course: identity first — name, language, level — then the same
 * option fields the sheet shows, prefilled with the defaults.
 *
 * The options are set here rather than left to a later edit because the first
 * class group can be opened minutes after the course, and it inherits the
 * certificate rule and the procedures the course carries. A course created on
 * defaults is a course whose first class groups certify by the wrong rule.
 *
 * Writes through `POST /api/v1/catalog/courses` — the usecase lives in
 * `packages/domain` behind `apps/api`, never in the browser (CLAUDE.md §8).
 */
export function NewCourseForm({
  languages,
  courses,
  onCancel,
  onCreated,
}: {
  languages: CourseLanguage[]
  /** The catalog — the landing page picker greys out the pages already linked. */
  courses: CourseRow[]
  onCancel: () => void
  onCreated: () => void
}) {
  const t = useTranslations('bo')

  const [name, setName] = useState('')
  const [language, setLanguage] = useState('')
  const [level, setLevel] = useState('')
  const [landingKey, setLandingKey] = useState<LandingCourseKey | null>(null)
  const [draftOptions, setDraftOptions] = useState<CourseOptions>(DEFAULT_COURSE_OPTIONS)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<CatalogErrorKey | null>(null)

  const identityReady = name.trim() !== '' && level.trim() !== '' && language !== ''
  // Every module carries its material link (OOC-94); the API refuses a course
  // short of one, so the form says which field is missing first.
  const ready = identityReady && moduleMaterialsReady(draftOptions)

  async function submit() {
    setSaving(true)
    setError(null)
    const { active: _active, ...options } = draftOptions
    const result = await catalogWrite('/courses', 'POST', {
      name: name.trim(),
      languageId: language,
      level: level.trim(),
      landingKey,
      ...options,
      moduleMaterials: moduleMaterialsPayload(options),
    })
    setSaving(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    onCreated()
  }

  return (
    <Card className="p-5">
      <p className="mb-4 text-sm font-semibold text-ink">{t('courses.new_title')}</p>

      <AutoGrid min="15rem" gap="gap-3">
        <label className="flex flex-col gap-1">
          <span className={labelClass}>{t('courses.field_language')}</span>
          {/* Picked from the list (OOC-128), never typed: free text is how
              "INGLES" ended up next to "Inglés". A language not on the list
              is opened first, on the Idiomas tab. */}
          <select
            value={language}
            onChange={(event) => setLanguage(event.target.value)}
            className={fieldClass}
          >
            <option value="">{t('courses.field_language_pick')}</option>
            {languages.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
          <span className="text-xs text-muted-foreground">{t('courses.field_language_hint_list')}</span>
        </label>

        <label className="flex flex-col gap-1">
          <span className={labelClass}>{t('courses.field_name')}</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t('courses.name_placeholder')}
            className={fieldClass}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className={labelClass}>{t('courses.field_level')}</span>
          <input
            value={level}
            onChange={(event) => setLevel(event.target.value)}
            placeholder={t('courses.level_placeholder')}
            className={fieldClass}
          />
        </label>

        <LandingKeyField value={landingKey} onChange={setLandingKey} courses={courses} />
      </AutoGrid>

      <div className="mt-5 border-t border-line pt-5">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t('courses.options_title')}
        </p>
        <CourseOptionFields
          value={draftOptions}
          onChange={setDraftOptions}
          wide
          hideActive
          showMaterialIssues={identityReady}
        />
      </div>

      <p className="mt-3 text-xs text-muted-foreground">{t('courses.options_hint')}</p>

      <div className="mt-4 flex items-center gap-2">
        <button
          type="button"
          disabled={!ready || saving}
          onClick={() => void submit()}
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand-blue px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-brand-blue-deep disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-brand-blue"
        >
          <BoIcon name="check" size={16} />
          {t('courses.create')}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-line px-3.5 py-2 text-sm font-semibold text-muted-foreground transition hover:text-ink"
        >
          {t('courses.cancel')}
        </button>
      </div>

      {error && (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {t(`catalog_errors.${error}`)}
        </p>
      )}
    </Card>
  )
}
