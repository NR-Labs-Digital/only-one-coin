'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import type { CertificateRule, CourseOptions } from '@/lib/backoffice/types'
import {
  moduleMaterialIssues,
  resizeModuleMaterials,
  setModuleMaterial,
} from '@/lib/backoffice/module-materials'
import { Toggle } from '@/components/backoffice/controls'
import { AutoGrid, fullRowClass } from '@/components/layout/auto-grid'

const CERTIFICATE_RULES: CertificateRule[] = ['automatic', 'exam_required']

const fieldClass =
  'rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink outline-none transition focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/15'

const labelClass =
  'text-xs font-medium uppercase tracking-wide text-muted-foreground'

/**
 * The configurable half of a course, shared by the create form and the options
 * sheet. One component on purpose: whoever opens a course sets these, and
 * coordination changes them later — if the two screens drifted, a course would
 * be created with a field the sheet cannot reach, or the other way round.
 */
export function CourseOptionFields({
  value,
  onChange,
  wide = false,
  hideActive = false,
  showMaterialIssues = false,
}: {
  value: CourseOptions
  onChange: (options: CourseOptions) => void
  /** Three fields across instead of two — the create form has the room, the sheet does not. */
  wide?: boolean
  /** A new course is born in the catalog — there is nothing to switch off yet. */
  hideActive?: boolean
  /**
   * Say "missing" beside every blank module link, not only the ones already
   * left — set once the links are what stands between the reader and Save.
   */
  showMaterialIssues?: boolean
}) {
  const t = useTranslations('bo')
  const [leftFields, setLeftFields] = useState<ReadonlySet<number>>(new Set())

  function set<K extends keyof CourseOptions>(key: K, next: CourseOptions[K]) {
    onChange({ ...value, [key]: next })
  }

  // The draft keeps every link typed; the module count only decides how many
  // fields show and how many are sent (OOC-94) — see setModuleMaterial.
  function setMaterial(index: number, link: string) {
    set('moduleMaterials', setModuleMaterial(value.moduleMaterials, value.modules, index, link))
  }

  // A course written before OOC-94 has no links yet: its fields show blank.
  const materials = resizeModuleMaterials(value.moduleMaterials, value.modules)
  const issues = moduleMaterialIssues(materials)

  return (
    <div className="flex flex-col gap-4">
      {/* The prop only sets how tight the columns may get: the sheet is
          narrow at every viewport width, so it packs the fields closer rather
          than waiting for a screen size that never arrives there. */}
      <AutoGrid min={wide ? '14rem' : '11rem'} gap="gap-3">
        <label className="flex flex-col gap-1">
          <span className={labelClass}>{t('course_options.min_age')}</span>
          <input
            type="number"
            min={0}
            max={99}
            value={value.minAge}
            onChange={(event) => set('minAge', Number(event.target.value))}
            className={`${fieldClass} tabular-nums`}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className={labelClass}>{t('course_options.modules')}</span>
          <input
            type="number"
            min={1}
            max={20}
            value={value.modules}
            onChange={(event) => set('modules', Number(event.target.value))}
            className={`${fieldClass} tabular-nums`}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className={labelClass}>{t('course_options.total_hours')}</span>
          <input
            type="number"
            min={1}
            max={999}
            value={value.totalHours}
            onChange={(event) => set('totalHours', Number(event.target.value))}
            className={`${fieldClass} tabular-nums`}
          />
        </label>

        {/* Full width: the rule names do not fit half a row, and a truncated
            one reads as a different rule. The hint carries the meaning the
            short label drops. */}
        <label
          className={`flex flex-col gap-1 ${fullRowClass}`}
        >
          <span className={labelClass}>{t('course_options.certificate_rule')}</span>
          <select
            value={value.certificateRule}
            onChange={(event) =>
              set('certificateRule', event.target.value as CertificateRule)
            }
            className={fieldClass}
          >
            {CERTIFICATE_RULES.map((rule) => (
              <option key={rule} value={rule}>
                {t(`certificate_rule.${rule}`)}
              </option>
            ))}
          </select>
          <span className="text-xs text-muted-foreground">
            {t(`certificate_rule_hint.${value.certificateRule}`)}
          </span>
        </label>
      </AutoGrid>

      {materials.length > 0 && (
        <fieldset className="flex flex-col gap-2">
          <legend className={`mb-1 ${labelClass}`}>{t('course_options.module_materials')}</legend>
          <AutoGrid min="16rem" gap="gap-3">
            {materials.map((link, index) => {
              const issue = issues[index]
              // A wrong link says so at once; a blank one only once it was
              // left, or once the links are all that keeps Save off.
              const shown =
                issue === 'invalid' || (issue === 'missing' && (showMaterialIssues || leftFields.has(index)))
                  ? issue
                  : null
              return (
                <label key={index} className="flex flex-col gap-1">
                  <span className={labelClass}>{t('course_options.module_material', { n: index + 1 })}</span>
                  <input
                    type="url"
                    inputMode="url"
                    value={link}
                    onChange={(event) => setMaterial(index, event.target.value)}
                    onBlur={() => setLeftFields((left) => new Set(left).add(index))}
                    aria-invalid={shown !== null}
                    className={fieldClass}
                  />
                  {shown && (
                    <span className="text-xs text-red-700">{t(`course_options.module_material_${shown}`)}</span>
                  )}
                </label>
              )
            })}
          </AutoGrid>
          <span className="text-xs text-muted-foreground">{t('course_options.module_materials_hint')}</span>
        </fieldset>
      )}

      <fieldset className="flex flex-col gap-3">
        <legend className={`mb-1 ${labelClass}`}>
          {t('course_options.procedures')}
        </legend>
        {(
          /* eslint-disable i18next/no-literal-string --
             second element of each tuple is an i18n *key* (fed to `t()`
             below), not text shown to the user. */
          [
            ['allowsTransfer', 'course_options.allows_transfer'],
            ['allowsFreeze', 'course_options.allows_freeze'],
          ] as const
          /* eslint-enable i18next/no-literal-string */
        ).map(([key, label]) => (
          <Toggle
            key={key}
            checked={value[key]}
            onChange={(next) => set(key, next)}
            label={t(label)}
          />
        ))}
      </fieldset>

      {!hideActive && (
        <div className="border-t border-line pt-4">
          <Toggle
            checked={value.active}
            onChange={(next) => set('active', next)}
            label={t('course_options.active')}
            hint={t('course_options.active_hint')}
          />
        </div>
      )}
    </div>
  )
}

/** What a course starts from before anyone touches it. */
export const DEFAULT_COURSE_OPTIONS: CourseOptions = {
  minAge: 13,
  modules: 4,
  moduleMaterials: ['', '', '', ''],
  totalHours: 80,
  certificateRule: 'automatic',
  allowsFreeze: true,
  allowsTransfer: false,
  active: true,
}
