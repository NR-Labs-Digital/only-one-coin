'use client'

import { useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import type { ClassGroupRow } from '@/lib/backoffice/types'
import { parseClassLink } from '@/lib/backoffice/class-links'
import { formatDateTime, type Locale } from '@/lib/format'
import { BoIcon } from '@/components/backoffice/icons'
import { ClassLinks, ExternalButton } from '@/components/backoffice/class-links'

/**
 * Everything a teacher needs to open before giving the class, in one place:
 *
 * - **From coordination** — the Meet and the Classroom the direction set for
 *   this class group in the backoffice. Read-only here.
 * - **Module material** — the Drive link coordination sets once per module;
 *   every class group on that module reads the same one. Read-only here.
 * - **For the students** — the Classroom link the teacher publishes, which
 *   the enrolled students pick up in their portal. The one thing on this card
 *   the teacher writes.
 *
 * External links only, never an integration (CLAUDE.md §2), and each one is
 * checked against the Google host it claims before it becomes an `href`.
 * The write is screen-local, like the rest of the mock: the real one is a
 * usecase in `apps/api` that compares the authenticated `teacher_id` with the
 * class group's (CLAUDE.md §8).
 */
export function ClassResources({
  group,
}: {
  group: Pick<
    ClassGroupRow,
    'meetUrl' | 'classroomUrl' | 'moduleNumber' | 'moduleMaterialsUrl' | 'studentClassroomUrl'
  >
}) {
  const t = useTranslations('bo')
  const locale = useLocale() as Locale

  const [published, setPublished] = useState(group.studentClassroomUrl ?? '')
  const [draft, setDraft] = useState(published)
  const [savedAt, setSavedAt] = useState<string | null>(null)

  const parsed = parseClassLink(draft, 'classroom')
  const invalid = parsed === null
  const changed = (parsed ?? draft.trim()) !== published

  const materialsUrl = group.moduleMaterialsUrl
    ? parseClassLink(group.moduleMaterialsUrl, 'drive')
    : null

  function publish() {
    if (invalid || !changed) return
    setPublished(parsed ?? '')
    setDraft(parsed ?? '')
    setSavedAt(new Date().toISOString())
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {t('class_resources.title')}
      </p>
      {/* One row of doors: the class (Meet, Classroom) and the module's
          material. A door with no link yet stays, greyed out. */}
      <div className="flex flex-wrap items-center gap-2">
        <ClassLinks group={group} />
        <ExternalButton
          href={materialsUrl}
          icon="doc"
          label={t('class_resources.materials')}
        />
      </div>

      {/* Publishing the students' Classroom is done once per group — folded
          away until the teacher comes to do it. The summary still says
          whether the students already have it. */}
      <details className="group/students rounded-lg border border-line bg-white">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-sm font-semibold text-ink">
          <span className="flex items-center gap-2">
            <BoIcon name="link" size={14} className="text-brand-blue" />
            {t('class_resources.for_students')}
          </span>
          <span className="flex items-center gap-2 text-xs font-normal text-muted-foreground">
            {published ? t('class_resources.published_short') : t('class_resources.not_published_short')}
            <BoIcon
              name="chevron-down"
              size={14}
              className="transition group-open/students:rotate-180"
            />
          </span>
        </summary>
        <div className="flex flex-col gap-2 border-t border-line px-3 py-3">
          <div className="flex flex-wrap gap-2">
            <input
              type="url"
              inputMode="url"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={t('class_resources.classroom_placeholder')}
              aria-label={t('class_resources.for_students')}
              aria-invalid={invalid}
              className={`min-w-0 flex-1 rounded-lg border bg-white px-3 py-1.5 text-sm text-ink outline-none transition focus:ring-2 ${
                invalid
                  ? 'border-red-400 focus:border-red-500 focus:ring-red-500/15'
                  : 'border-line focus:border-brand-blue focus:ring-brand-blue/15'
              }`}
            />
            <button
              type="button"
              onClick={publish}
              disabled={invalid || !changed}
              className="inline-flex min-h-tap items-center gap-1.5 rounded-lg bg-brand-blue px-3 text-sm font-semibold text-white transition hover:bg-brand-blue-deep disabled:cursor-default disabled:opacity-50 sm:min-h-0 sm:py-1.5"
            >
              <BoIcon name="check" size={15} />
              {t('class_resources.publish')}
            </button>
          </div>
          {invalid ? (
            <p className="text-xs font-semibold text-red-600">
              {t('class_resources.classroom_invalid')}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              {published ? t('class_resources.students_see') : t('class_resources.students_none')}
            </p>
          )}
          {savedAt && (
            <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <BoIcon name="alert" size={14} className="mt-0.5 shrink-0" />
              {t('class_resources.saved_local_only', { time: formatDateTime(savedAt, locale) })}
            </p>
          )}
        </div>
      </details>
    </div>
  )
}
