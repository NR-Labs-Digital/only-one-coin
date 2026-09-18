'use client'

import { useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import type { AcademicSettings } from '@/lib/backoffice/types'
import { formatMoney, type Locale } from '@/lib/format'
import { Card } from '@/components/backoffice/ui'
import { Toast } from '@/components/backoffice/controls'
import { Notice, Row, SettingsActions, numberClass } from './settings-ui'

/**
 * The academic numbers the platform runs on: what counts as approved, how long
 * the institution has to issue, what a paid procedure costs and how early a
 * contract starts warning. All of them are settings rather than constants for
 * the reason CLAUDE.md §5 gives about the tolerance: the Asociación changing
 * what a rule means must not require a deploy.
 *
 * Nothing is submitted yet: there is no API behind this screen, and the save
 * button says so.
 */
export function AcademicSettingsForm({ settings }: { settings: AcademicSettings }) {
  const t = useTranslations('bo')
  const locale = useLocale() as Locale

  const [draft, setDraft] = useState<AcademicSettings>(settings)
  const [toast, setToast] = useState<string | null>(null)

  const dirty = JSON.stringify(draft) !== JSON.stringify(settings)

  function set<K extends keyof AcademicSettings>(key: K, value: AcademicSettings[K]) {
    setDraft({ ...draft, [key]: value })
  }

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
              min={0}
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

      <SettingsActions
        dirty={dirty}
        onSave={() => setToast(t('settings.saved_toast'))}
        onCancel={() => setDraft(settings)}
      />

      <Toast message={toast} onDismiss={() => setToast(null)} />
    </div>
  )
}
