'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import type { LandingCourseKey } from '@ooc/domain/landing-course-keys'
import type {
  CatalogErrorKey,
  CourseLanguage,
  CourseOptions,
  CourseRow,
} from '@/lib/backoffice/types'
import { catalogWrite, setCatalogEntryOnOffer } from '@/lib/backoffice/catalog-client'
import { parseClassLink } from '@/lib/backoffice/class-links'
import { moduleMaterialIssues, sameModuleMaterials } from '@/lib/backoffice/module-materials'
import {
  blankedIdentityFields,
  identityOf,
  identityPatch,
  type CourseIdentity,
  type RequiredIdentityField,
} from '@/lib/backoffice/course-identity'
import { BoIcon } from '@/components/backoffice/icons'
import { Toast } from '@/components/backoffice/controls'
import { Card, SectionTitle } from '@/components/backoffice/ui'
import {
  LiveEnrollmentsNotice,
  useLiveEnrollments,
} from '@/components/backoffice/retire-confirmation'
import { CourseOptionFields } from './course-option-fields'
import { LandingKeyField } from './landing-key-field'

const fieldClass =
  'rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink outline-none transition focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/15'

const labelClass = 'text-xs font-medium uppercase tracking-wide text-muted-foreground'

function optionsOf(course: CourseRow): CourseOptions {
  return {
    minAge: course.minAge,
    modules: course.modules,
    moduleMaterials: course.moduleMaterials,
    totalHours: course.totalHours,
    certificateRule: course.certificateRule,
    allowsFreeze: course.allowsFreeze,
    allowsTransfer: course.allowsTransfer,
    active: course.active,
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
 * (CLAUDE.md §5). Plans live beside this form on the course page, each action
 * written on its own — this Save never touches them.
 *
 * The landing page link (OOC-117) follows the identity: it decides what the
 * public website sells.
 *
 * Unticking "in catalog" retires the course on save. Before that, the form
 * reads how many enrollments are still standing on it and says so (CLAUDE.md
 * §1, "avisa, não bloqueia").
 */
export function CourseOptionsForm({
  course,
  courses,
  languages,
  canEditIdentity,
}: {
  course: CourseRow
  /** The whole catalog — to tell which landing pages another course holds. */
  courses: CourseRow[]
  /** The languages in use — named under the language field, like on creation. */
  languages: CourseLanguage[]
  canEditIdentity: boolean
}) {
  const t = useTranslations('bo')
  const router = useRouter()
  // Read once: a plan written beside this form refreshes the page, and that
  // must not throw away options the reader is halfway through editing.
  const [draft, setDraft] = useState<CourseOptions>(() => optionsOf(course))
  const [identity, setIdentity] = useState<CourseIdentity>(() => identityOf(course))
  const [landingKey, setLandingKey] = useState<LandingCourseKey | null>(course.landingKey)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<CatalogErrorKey | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const retiring = course.active && !draft.active
  const live = useLiveEnrollments('course', course.id, retiring)

  // Name, language and level may change but not go blank (the API refuses
  // them too). Only an edit counts: a course that predates OOC-36 has no level,
  // and that must not lock the rest of the form (OOC-126).
  const blanked = canEditIdentity ? blankedIdentityFields(identityPatch(course, identity)) : []

  // Module links are asked for only when the modules are touched (OOC-94): a
  // course that predates them keeps saving its other options.
  const modulesTouched =
    draft.modules !== course.modules || !sameModuleMaterials(draft.moduleMaterials, course.moduleMaterials)
  const materialsBlocked =
    modulesTouched &&
    (draft.moduleMaterials.length !== draft.modules ||
      moduleMaterialIssues(draft.moduleMaterials).some((issue) => issue !== null))

  // Save sits at the bottom of a long form; the reason it is off must sit by
  // the field, or the button just reads as broken.
  function requiredNotice(field: RequiredIdentityField) {
    if (!blanked.includes(field)) return null
    return <span className="text-xs text-red-700">{t('course_options.required')}</span>
  }

  function discard() {
    setDraft(optionsOf(course))
    setIdentity(identityOf(course))
    setLandingKey(course.landingKey)
    setError(null)
  }

  async function save() {
    setSaving(true)
    setError(null)
    const { active, modules, moduleMaterials, ...options } = draft
    const changed = (Object.keys(options) as (keyof typeof options)[]).filter(
      (key) => options[key] !== course[key],
    )
    if (changed.length > 0 || modulesTouched) {
      const patch = {
        ...Object.fromEntries(changed.map((key) => [key, options[key]])),
        // The count and its links travel together: the API checks one against the other.
        ...(modulesTouched && {
          modules,
          moduleMaterials: moduleMaterials.map((link) => parseClassLink(link, 'drive') ?? link),
        }),
      }
      const result = await catalogWrite(`/courses/${course.id}/options`, 'PATCH', patch)
      if (!result.ok) {
        setSaving(false)
        setError(result.error)
        return
      }
    }
    if (canEditIdentity) {
      const patch = {
        ...identityPatch(course, identity),
        ...(landingKey !== course.landingKey && { landingKey }),
      }
      if (Object.keys(patch).length > 0) {
        const result = await catalogWrite(`/courses/${course.id}`, 'PATCH', patch)
        if (!result.ok) {
          setSaving(false)
          setError(result.error)
          return
        }
      }
    }
    if (active !== course.active) {
      const result = await setCatalogEntryOnOffer('course', course.id, active ? 'restore' : 'retire')
      setSaving(false)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setToast(
        active
          ? t('courses.restored')
          : t('courses.retired_notice', { count: result.data.liveEnrollments }),
      )
      router.refresh()
      return
    }
    setSaving(false)
    setToast(t('courses.saved'))
    router.refresh()
  }

  return (
    <Card as="section" className="flex flex-col gap-4 p-5">
      <SectionTitle icon="settings">{t('courses.options_title')}</SectionTitle>

      <p className="flex items-start gap-2 rounded-lg border border-dashed border-line bg-sky-soft px-3 py-2 text-xs text-muted-foreground">
        <BoIcon name="alert" size={14} className="mt-0.5 shrink-0" />
        {t('course_options.applies_forward')}
      </p>

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
              aria-invalid={blanked.includes('name')}
              className={fieldClass}
            />
            {requiredNotice('name')}
          </label>
          <label className="flex flex-col gap-1">
            <span className={labelClass}>{t('courses.field_language')}</span>
            <input
              value={identity.language}
              onChange={(event) => setIdentity({ ...identity, language: event.target.value })}
              aria-invalid={blanked.includes('language')}
              className={fieldClass}
            />
            {requiredNotice('language')}
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
              aria-invalid={blanked.includes('level')}
              className={fieldClass}
            />
            {requiredNotice('level')}
          </label>
          <label className="flex flex-col gap-1">
            <span className={labelClass}>{t('course_options.summary')}</span>
            <textarea
              value={identity.summary}
              rows={3}
              onChange={(event) => setIdentity({ ...identity, summary: event.target.value })}
              className={fieldClass}
            />
            <span className="text-xs text-muted-foreground">{t('course_options.summary_hint')}</span>
          </label>
          <p className="text-xs text-muted-foreground">{t('course_options.identity_hint')}</p>
        </section>
      )}

      <CourseOptionFields value={draft} onChange={setDraft} showMaterialIssues={modulesTouched} />

      {retiring && <LiveEnrollmentsNotice state={live} />}

      {canEditIdentity && (
        <LandingKeyField
          value={landingKey}
          onChange={setLandingKey}
          courses={courses}
          selfId={course.id}
        />
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={
            saving || blanked.length > 0 || materialsBlocked || (retiring && live.status === 'loading')
          }
          onClick={() => void save()}
          className="inline-flex min-h-tap items-center gap-1.5 rounded-lg bg-brand-blue px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-brand-blue-deep disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-brand-blue"
        >
          <BoIcon name="check" size={16} />
          {t('course_options.save')}
        </button>
        <button
          type="button"
          onClick={discard}
          className="inline-flex min-h-tap items-center rounded-lg border border-line px-3.5 py-2 text-sm font-semibold text-muted-foreground transition hover:text-ink"
        >
          {t('course_options.cancel')}
        </button>
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-700">
          {t(`catalog_errors.${error}`)}
        </p>
      )}

      <Toast message={toast} onDismiss={() => setToast(null)} />
    </Card>
  )
}
