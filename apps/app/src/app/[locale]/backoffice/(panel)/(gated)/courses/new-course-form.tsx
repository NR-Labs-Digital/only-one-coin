'use client'

import { useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import type { LandingCourseKey } from '@ooc/domain/landing-course-keys'
import type {
  CatalogErrorKey,
  CourseDetail,
  CourseLanguage,
  CourseOptions,
  CourseRow,
  PlanBilling,
} from '@/lib/backoffice/types'
import { catalogWrite } from '@/lib/backoffice/catalog-client'
import { moduleMaterialsPayload, moduleMaterialsReady } from '@/lib/backoffice/module-materials'
import { Card } from '@/components/backoffice/ui'
import { BoIcon } from '@/components/backoffice/icons'
import { CourseOptionFields, DEFAULT_COURSE_OPTIONS } from './course-option-fields'
import { AutoGrid } from '@/components/layout/auto-grid'
import { HelpField, HelpHint } from '@/components/backoffice/help-hint'
import { formatMoney, type Locale } from '@/lib/format'
import { LandingKeyField } from './landing-key-field'

/** One plan of the source, as the copy will carry it (OOC-182). */
interface PlanCopy {
  sourcePlanId: string
  name: string
  /** Fixed: it rides on the source plan, and a plan's billing never changes. */
  billing: PlanBilling
  /** Soles, as typed — the source's price in force is only the starting point. */
  amount: string
  included: boolean
}

/** The same comparison the API makes: case, accents and stray spaces do not make a new name. */
function nameKey(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').trim().replace(/\s+/g, ' ').toLowerCase()
}

function centsOf(amount: string): number | null {
  const cents = Math.round(Number(amount) * 100)
  return amount.trim() !== '' && Number.isFinite(cents) && cents > 0 ? cents : null
}

function copiesOf(source: CourseDetail): PlanCopy[] {
  return source.plans
    .filter((plan) => plan.active)
    .map((plan) => {
      const current = plan.prices.find((price) => price.id === plan.currentPriceId)
      return {
        sourcePlanId: plan.id,
        name: plan.name,
        billing: plan.billing,
        amount: current ? (current.amountCents / 100).toFixed(2) : '',
        included: true,
      }
    })
}

function optionsOf(course: CourseRow): CourseOptions {
  return {
    minAge: course.minAge,
    modules: course.modules,
    // A course from before OOC-94 has no links: the copy asks for them.
    moduleMaterials: Array.from({ length: course.modules }, (_, index) => course.moduleMaterials[index] ?? ''),
    totalHours: course.totalHours,
    certificateRule: course.certificateRule,
    allowsFreeze: course.allowsFreeze,
    allowsTransfer: course.allowsTransfer,
    allowsEnrollmentTransfer: course.allowsEnrollmentTransfer,
    active: true,
  }
}

const fieldClass =
  'rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink outline-none transition focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/15'

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
 *
 * With a `source` it is "Duplicar curso" (OOC-182): the same form, filled in
 * from that course, plus its plans with the price in force as the starting
 * amount. Nothing is written until Save, and the save goes to
 * `POST /catalog/courses/:id/duplicate` — one transaction for the course and
 * its plans. The landing page never comes along (one live course per page).
 */
export function NewCourseForm({
  languages,
  courses,
  source,
  onCancel,
  onCreated,
}: {
  languages: CourseLanguage[]
  /** The catalog — the landing page picker greys out the pages already linked. */
  courses: CourseRow[]
  /** The course being duplicated, with its plans (OOC-182). */
  source?: CourseDetail
  onCancel: () => void
  onCreated: (id: string) => void
}) {
  const t = useTranslations('bo')
  const locale = useLocale() as Locale

  const [name, setName] = useState(source?.course.name ?? '')
  // A retired language is not on the list: the copy must pick a live one.
  const [language, setLanguage] = useState(() =>
    source && languages.some((item) => item.id === source.course.language.id) ? source.course.language.id : '',
  )
  const [level, setLevel] = useState(source?.course.level ?? '')
  const [landingKey, setLandingKey] = useState<LandingCourseKey | null>(null)
  const [draftOptions, setDraftOptions] = useState<CourseOptions>(() =>
    source ? optionsOf(source.course) : DEFAULT_COURSE_OPTIONS,
  )
  const [plans, setPlans] = useState<PlanCopy[]>(() => (source ? copiesOf(source) : []))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<CatalogErrorKey | null>(null)

  // A copy under the source's own name would read as the same course on every list.
  const nameUnchanged = source !== undefined && nameKey(name) === nameKey(source.course.name)
  const identityReady = name.trim() !== '' && level.trim() !== '' && language !== '' && !nameUnchanged
  const plansReady = plans.every((plan) => !plan.included || (plan.name.trim() !== '' && centsOf(plan.amount) !== null))
  // Every module carries its material link (OOC-94); the API refuses a course
  // short of one, so the form says which field is missing first.
  const ready = identityReady && moduleMaterialsReady(draftOptions) && plansReady

  function editPlan(sourcePlanId: string, patch: Partial<PlanCopy>) {
    setPlans((current) => current.map((plan) => (plan.sourcePlanId === sourcePlanId ? { ...plan, ...patch } : plan)))
  }

  async function submit() {
    setSaving(true)
    setError(null)
    const { active: _active, ...options } = draftOptions
    const identity = {
      name: name.trim(),
      languageId: language,
      level: level.trim(),
      ...options,
      moduleMaterials: moduleMaterialsPayload(options),
    }
    const result = source
      ? await catalogWrite(`/courses/${source.course.id}/duplicate`, 'POST', {
          ...identity,
          plans: plans
            .filter((plan) => plan.included)
            .map((plan) => ({
              sourcePlanId: plan.sourcePlanId,
              name: plan.name.trim(),
              amountCents: centsOf(plan.amount),
            })),
        })
      : await catalogWrite('/courses', 'POST', { ...identity, landingKey })
    setSaving(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    onCreated(result.data.id)
  }

  return (
    <Card className="p-5">
      <p className="mb-4 text-sm font-semibold text-ink">
        {source ? t('courses.duplicate_title', { name: source.course.name }) : t('courses.new_title')}
      </p>
      {source && <p className="-mt-2 mb-4 text-xs text-muted-foreground">{t('courses.duplicate_intro')}</p>}

      <AutoGrid min="15rem" gap="gap-3">
        <HelpField
          label={t('courses.field_language')}
          what={t('help.course_language_what')}
          how={t('courses.field_language_hint_list')}
        >
          {(id) => (
            /* Picked from the list (OOC-128), never typed: free text is how
               "INGLES" ended up next to "Inglés". A language not on the list
               is opened first, on the Idiomas tab. */
            <select
              id={id}
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
          )}
        </HelpField>

        <HelpField label={t('courses.field_name')} what={t('help.course_name_what')}>
          {(id) => (
            <>
              <input
                id={id}
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={t('courses.name_placeholder')}
                aria-invalid={nameUnchanged || undefined}
                className={fieldClass}
              />
              {nameUnchanged && (
                <span className="text-xs text-amber-700">{t('courses.duplicate_name_unchanged')}</span>
              )}
            </>
          )}
        </HelpField>

        <HelpField label={t('courses.field_level')} what={t('help.course_level_what')}>
          {(id) => (
            <input
              id={id}
              value={level}
              onChange={(event) => setLevel(event.target.value)}
              placeholder={t('courses.level_placeholder')}
              className={fieldClass}
            />
          )}
        </HelpField>

        {source ? (
          <div className="flex flex-col gap-1">
            <span className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t('landing_key.label')}
              <HelpHint what={t('help.course_duplicate_landing_what')} how={t('help.course_duplicate_landing_how')} />
            </span>
            <span className="py-2 text-sm text-muted-foreground">{t('courses.duplicate_no_landing')}</span>
          </div>
        ) : (
          <LandingKeyField value={landingKey} onChange={setLandingKey} courses={courses} />
        )}
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
        />
      </div>

      <p className="mt-3 text-xs text-muted-foreground">{t('courses.options_hint')}</p>

      {source && (
        <div className="mt-5 border-t border-line pt-5">
          <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t('courses.duplicate_plans_title')}
            <HelpHint what={t('help.course_duplicate_plans_what')} how={t('help.course_duplicate_plans_how')} />
          </p>
          {plans.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('courses.duplicate_no_plans')}</p>
          ) : (
            <ul className="mt-3 flex flex-col gap-3">
              {plans.map((plan) => {
                const missingAmount = plan.included && centsOf(plan.amount) === null
                return (
                  <li key={plan.sourcePlanId} className="rounded-lg border border-line p-3">
                    <label className="flex min-h-tap items-center gap-2 text-sm font-semibold text-ink">
                      <input
                        type="checkbox"
                        checked={plan.included}
                        onChange={(event) => editPlan(plan.sourcePlanId, { included: event.target.checked })}
                      />
                      <span>
                        {t('courses.duplicate_plan_include')}{' '}
                        <span className="font-normal text-muted-foreground">
                          · {t(plan.billing === 'monthly' ? 'plans.billing_monthly' : 'plans.billing_package')}
                        </span>
                      </span>
                    </label>
                    {plan.included && (
                      <AutoGrid min="12rem" gap="gap-3" className="mt-2">
                        <label className="flex flex-col gap-1">
                          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                            {t('plans.plan_name')}
                          </span>
                          <input
                            value={plan.name}
                            onChange={(event) => editPlan(plan.sourcePlanId, { name: event.target.value })}
                            className={fieldClass}
                          />
                        </label>
                        <label className="flex flex-col gap-1">
                          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                            {plan.billing === 'monthly' ? t('courses.duplicate_amount_module') : t('plans.amount')}
                          </span>
                          <input
                            type="number"
                            inputMode="decimal"
                            step="0.01"
                            min="0.01"
                            value={plan.amount}
                            onChange={(event) => editPlan(plan.sourcePlanId, { amount: event.target.value })}
                            aria-invalid={missingAmount || undefined}
                            className={fieldClass}
                          />
                          {missingAmount ? (
                            <span className="text-xs text-amber-700">{t('courses.duplicate_amount_missing')}</span>
                          ) : (
                            centsOf(plan.amount) !== null && (
                              <span className="text-xs text-muted-foreground">
                                {formatMoney(centsOf(plan.amount)!, 'PEN', locale)}
                              </span>
                            )
                          )}
                        </label>
                      </AutoGrid>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}

      <div className="mt-4 flex items-center gap-2">
        <button
          type="button"
          disabled={!ready || saving}
          onClick={() => void submit()}
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand-blue px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-brand-blue-deep disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-brand-blue"
        >
          <BoIcon name="check" size={16} />
          {t(source ? 'courses.duplicate_create' : 'courses.create')}
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
