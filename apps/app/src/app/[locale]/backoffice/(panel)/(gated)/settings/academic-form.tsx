'use client'

import { useLocale, useTranslations } from 'next-intl'
import type { PlatformSettings } from '@/lib/backoffice/platform-settings'
import { formatMoney, type Locale } from '@/lib/format'
import { Card } from '@/components/backoffice/ui'
import { Toast } from '@/components/backoffice/controls'
import { Notice, Row, SettingsActions, numberClass, useSettingsForm } from './settings-ui'

/** The academic half of the settings. */
export type AcademicSettings = Pick<
  PlatformSettings,
  'passingGrade' | 'certificateDeadlineBusinessDays' | 'constanciaFeeCents' | 'contractAlertDays'
>

/**
 * The academic numbers the platform runs on: what counts as approved, how long
 * the institution has to issue, what a paid procedure costs and how early a
 * contract starts warning. Settings rather than constants: the Asociación
 * changing what a rule means must not require a deploy.
 *
 * Saved to `apps/api` (`PATCH /settings`, OOC-41), one audit entry per
 * changed number; grades, certificates, the student's documents and the
 * teacher roster read them from there.
 */
export function AcademicSettingsForm({ settings }: { settings: AcademicSettings }) {
  const t = useTranslations('bo')
  const locale = useLocale() as Locale
  const { draft, set, dirty, saving, toast, dismissToast, save, cancel } = useSettingsForm(settings)

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <Card className="divide-y divide-line">
          <Row
            helpLabel={t('common.help')}
            label={t('settings.passing_grade_label')}
            hint={t('settings.passing_grade_hint')}
            value={t('settings.passing_grade_value', { grade: draft.passingGrade })}
          >
            <input
              type="number"
              min={0}
              max={20}
              step={1}
              aria-label={t('settings.passing_grade_label')}
              value={draft.passingGrade}
              onChange={(event) => set('passingGrade', Number(event.target.value))}
              className={numberClass}
            />
          </Row>

          <Row
            helpLabel={t('common.help')}
            label={t('settings.certificate_deadline_label')}
            hint={t('settings.certificate_deadline_hint')}
            value={t('settings.business_days_value', {
              days: draft.certificateDeadlineBusinessDays,
            })}
          >
            <input
              type="number"
              min={1}
              max={90}
              aria-label={t('settings.certificate_deadline_label')}
              value={draft.certificateDeadlineBusinessDays}
              onChange={(event) =>
                set('certificateDeadlineBusinessDays', Number(event.target.value))
              }
              className={numberClass}
            />
          </Row>

          <Row
            helpLabel={t('common.help')}
            label={t('settings.constancia_fee_label')}
            hint={t('settings.constancia_fee_hint')}
            value={formatMoney(draft.constanciaFeeCents, 'PEN', locale)}
          >
            <input
              type="number"
              min={1}
              max={1000}
              step={0.5}
              aria-label={t('settings.constancia_fee_label')}
              value={draft.constanciaFeeCents / 100}
              onChange={(event) =>
                // Soles typed by hand are the only float in the flow, and it
                // stops on this line: what is stored is integer cents
                // (CLAUDE.md §5).
                set('constanciaFeeCents', Math.round(Number(event.target.value) * 100))
              }
              className={numberClass}
            />
          </Row>

          <Row
            helpLabel={t('common.help')}
            label={t('settings.contract_alert_label')}
            hint={t('settings.contract_alert_hint')}
            value={t('settings.days_value', { days: draft.contractAlertDays })}
          >
            <input
              type="number"
              min={1}
              max={180}
              aria-label={t('settings.contract_alert_label')}
              value={draft.contractAlertDays}
              onChange={(event) => set('contractAlertDays', Number(event.target.value))}
              className={numberClass}
            />
          </Row>
        </Card>
        <Notice>{t('settings.academic_notice')}</Notice>
      </section>

      <SettingsActions dirty={dirty} saving={saving} onSave={save} onCancel={cancel} />

      <Toast message={toast} onDismiss={dismissToast} />
    </div>
  )
}
