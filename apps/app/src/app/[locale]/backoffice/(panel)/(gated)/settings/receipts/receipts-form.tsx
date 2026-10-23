'use client'

import { useLocale, useTranslations } from 'next-intl'
import type { PlatformSettings } from '@/lib/backoffice/platform-settings'
import { formatMoney, type Locale } from '@/lib/format'
import { Card } from '@/components/backoffice/ui'
import { Toast } from '@/components/backoffice/controls'
import { Notice, Row, SettingsActions, numberClass, useSettingsForm } from '../settings-ui'

/** The receipt half of the settings. */
export type ReceiptSettings = Pick<
  PlatformSettings,
  | 'receiptAmountToleranceCents'
  | 'receiptRejectBelowPercent'
  | 'ocrLowConfidencePercent'
  | 'checkoutHoldMinutes'
  | 'reviewWindowDays'
>

/**
 * The receipt numbers: what the traffic light calls green and red, the
 * confidence below which a field read by the OCR is flagged to the reviewer,
 * and the seat's two clocks. None of them approves anything — a person does,
 * in Payments (owner, 03/10/2026).
 *
 * Saved to `apps/api` (`PATCH /settings`, OOC-41), one audit entry per changed
 * number. They apply to the next receipt, hold or deadline — never to one
 * already decided.
 */
export function ReceiptSettingsForm({ settings }: { settings: ReceiptSettings }) {
  const t = useTranslations('bo')
  const locale = useLocale() as Locale
  const { draft, set, dirty, saving, toast, dismissToast, save, cancel } = useSettingsForm(settings)

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <Card className="divide-y divide-line">
          <Row
            helpLabel={t('common.help')}
            label={t('settings.tolerance_label')}
            hint={t('settings.tolerance_hint')}
            value={formatMoney(draft.receiptAmountToleranceCents, 'PEN', locale)}
          >
            <input
              type="number"
              min={0}
              max={50}
              step={0.1}
              aria-label={t('settings.tolerance_label')}
              value={draft.receiptAmountToleranceCents / 100}
              onChange={(event) =>
                // Soles typed by hand stop being a float on this line: what is
                // stored is integer cents (CLAUDE.md §6).
                set('receiptAmountToleranceCents', Math.round(Number(event.target.value) * 100))
              }
              className={numberClass}
            />
          </Row>

          <Row
            helpLabel={t('common.help')}
            label={t('settings.reject_below_label')}
            hint={t('settings.reject_below_hint')}
            value={t('settings.reject_below_value', { percent: draft.receiptRejectBelowPercent })}
          >
            <input
              type="number"
              min={1}
              max={99}
              aria-label={t('settings.reject_below_label')}
              value={draft.receiptRejectBelowPercent}
              onChange={(event) => set('receiptRejectBelowPercent', Number(event.target.value))}
              className={numberClass}
            />
          </Row>

          <Row
            helpLabel={t('common.help')}
            label={t('settings.confidence_label')}
            hint={t('settings.confidence_hint')}
            value={t('settings.confidence_value', { value: draft.ocrLowConfidencePercent })}
          >
            <input
              type="range"
              min={50}
              max={95}
              step={1}
              aria-label={t('settings.confidence_label')}
              value={draft.ocrLowConfidencePercent}
              onChange={(event) => set('ocrLowConfidencePercent', Number(event.target.value))}
              className="w-32 accent-brand-blue"
            />
          </Row>

          {/* The seat's two clocks, side by side: the minutes somebody has to
              pay before the seat goes back, then the days the paid-but-
              unreviewed payment waits for a decision. Split across two screens
              is how they end up contradicting each other. */}
          <Row
            helpLabel={t('common.help')}
            label={t('settings.checkout_hold_label')}
            hint={t('settings.checkout_hold_hint')}
            value={t('settings.checkout_hold_value', { minutes: draft.checkoutHoldMinutes })}
          >
            <input
              type="number"
              min={5}
              max={60}
              aria-label={t('settings.checkout_hold_label')}
              value={draft.checkoutHoldMinutes}
              onChange={(event) => set('checkoutHoldMinutes', Number(event.target.value))}
              className={numberClass}
            />
          </Row>

          <Row
            helpLabel={t('common.help')}
            label={t('settings.reservation_label')}
            hint={t('settings.reservation_hint')}
            value={t('settings.reservation_value', { days: draft.reviewWindowDays })}
          >
            <input
              type="number"
              min={1}
              max={30}
              aria-label={t('settings.reservation_label')}
              value={draft.reviewWindowDays}
              onChange={(event) => set('reviewWindowDays', Number(event.target.value))}
              className={numberClass}
            />
          </Row>
        </Card>
        <Notice>{t('settings.receipts_notice')}</Notice>
      </section>

      <SettingsActions dirty={dirty} saving={saving} onSave={save} onCancel={cancel} />

      <Toast message={toast} onDismiss={dismissToast} />
    </div>
  )
}
