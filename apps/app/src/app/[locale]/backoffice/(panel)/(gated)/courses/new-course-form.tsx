'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import type {
  CourseLanguage,
  CourseOptions,
  CourseRow,
} from '@/lib/backoffice/types'
import { Card } from '@/components/backoffice/ui'
import { BoIcon } from '@/components/backoffice/icons'
import { CourseOptionFields, DEFAULT_COURSE_OPTIONS } from './course-option-fields'
import { AutoGrid } from '@/components/layout/auto-grid'

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
 * Screen-local, like the class group form: the real write is a usecase in
 * `packages/domain` behind `apps/api`, never the browser (CLAUDE.md §8).
 */
export function NewCourseForm({
  languages,
  onCancel,
  onCreate,
}: {
  languages: CourseLanguage[]
  onCancel: () => void
  onCreate: (course: CourseRow) => void
}) {
  const t = useTranslations('bo')

  const [name, setName] = useState('')
  const [languageId, setLanguageId] = useState(languages[0]?.id ?? '')
  const [level, setLevel] = useState('')
  const [summary, setSummary] = useState('')
  const [options, setOptions] = useState<CourseOptions>(DEFAULT_COURSE_OPTIONS)

  const ready =
    name.trim() !== '' &&
    level.trim() !== '' &&
    summary.trim() !== '' &&
    languageId !== ''

  function submit() {
    const language = languages.find((item) => item.id === languageId)
    if (!language) return
    onCreate({
      id: `crs_local_${name.trim().toLowerCase().replace(/\s+/g, '_')}`,
      name: name.trim(),
      language,
      level: level.trim(),
      summary: summary.trim(),
      ...options,
      classGroupCount: 0,
    })
  }

  return (
    <Card className="p-5">
      <p className="mb-4 text-sm font-semibold text-ink">{t('courses.new_title')}</p>

      <AutoGrid min="15rem" gap="gap-3">
        <label className="flex flex-col gap-1">
          <span className={labelClass}>{t('courses.field_language')}</span>
          <select
            value={languageId}
            onChange={(event) => setLanguageId(event.target.value)}
            className={fieldClass}
          >
            {languages.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
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

        {/* Full width: it is a paragraph, not a token. */}
        <label className="flex flex-col gap-1" style={{ gridColumn: '1 / -1' }}>
          <span className={labelClass}>{t('courses.field_summary')}</span>
          <textarea
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            rows={3}
            className={`${fieldClass} resize-y`}
          />
        </label>
      </AutoGrid>

      <div className="mt-5 border-t border-line pt-5">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t('courses.options_title')}
        </p>
        <CourseOptionFields value={options} onChange={setOptions} wide />
      </div>

      <p className="mt-3 text-xs text-muted-foreground">{t('courses.options_hint')}</p>

      <div className="mt-4 flex items-center gap-2">
        <button
          type="button"
          disabled={!ready}
          onClick={submit}
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
    </Card>
  )
}
