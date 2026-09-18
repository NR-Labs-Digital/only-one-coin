'use client'

import { useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import type { PaymentSettings } from '@/lib/backoffice/types'
import { formatMoney, type Locale } from '@/lib/format'
import { Card } from '@/components/backoffice/ui'
import { Toast } from '@/components/backoffice/controls'
import { Notice, Row, SettingsActions, numberClass } from '../settings-ui'

/**
 * The receipt numbers the pipeline approves on before it asks for a human:
 * the value tolerance, the confidence floor that escalates, and the seat's two
 * clocks. Settings rather than constants for the reason CLAUDE.md §5 gives
 * about the tolerance: changing what a rule means must not require a deploy.
 *
 * Nothing is submitted yet: there is no API behind this screen, and the save
 * button says so.
 */
export function ReceiptSettingsForm({ settings }: { settings: PaymentSettings }) {
  const t = useTranslations('bo')
  const locale = useLocale() as Locale

  const [draft, setDraft] = useState<PaymentSettings>(settings)
  const [toast, setToast] = useState<string | null>(null)

  const dirty = JSON.stringify(draft) !== JSON.stringify(settings)

  function set<K extends keyof PaymentSettings>(key: K, value: PaymentSettings[K]) {
    setDraft({ ...draft, [key]: value })
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <Card className="divide-y divide-line">
          <Row
            helpLabel={t('common.help')}
            label={t('settings.tolerance_label')}
            hint={t('settings.tolerance_hint')}
            value={formatMoney(draft.toleranceCents, 'PEN', locale)}
          >
            <input
              type="number"
              min={0}
              max={50}
              step={0.5}
              aria-label={t('settings.tolerance_label')}
              value={draft.toleranceCents / 100}
              onChange={(event) =>
                set('toleranceCents', Math.round(Number(event.target.value) * 100))
              }
              className={numberClass}
            />
          </Row>

          <Row
            helpLabel={t('common.help')}
            label={t('settings.confidence_label')}
            hint={t('settings.confidence_hint')}
            value={t('settings.confidence_value', {
              value: Math.round(draft.escalationConfidence * 100),
            })}
          >
            <input
              type="range"
              min={50}
              max={95}
              step={1}
              aria-label={t('settings.confidence_label')}
              value={Math.round(draft.escalationConfidence * 100)}
              onChange={(event) =>
                set('escalationConfidence', Number(event.target.value) / 100)
              }
              className="w-32 accent-brand-blue"
            />
          </Row>

          {/* The seat's other clock. It sits beside the reservation window
              because the two are one rule read at two speeds: this is the
              minutes somebody has to pay before the seat goes back, that is the
              days the paid-but-unreviewed seat waits (CLAUDE.md §5). Split
              across two screens is how they end up contradicting each other. */}
          <Row
            helpLabel={t('common.help')}
            label={t('settings.checkout_hold_label')}
            hint={t('settings.checkout_hold_hint')}
            value={t('settings.checkout_hold_value', {
              minutes: draft.checkoutHoldMinutes,
            })}
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
            value={t('settings.reservation_value', { days: draft.reservationDays })}
          >
            <input
              type="number"
              min={1}
              max={30}
              aria-label={t('settings.reservation_label')}
              value={draft.reservationDays}
              onChange={(event) => set('reservationDays', Number(event.target.value))}
              className={numberClass}
            />
          </Row>
        </Card>
        <Notice>{t('settings.receipts_notice')}</Notice>
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
