'use client'

import { useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { formatMoney, type Locale } from '@/lib/format'
import { saveConstanciaPrice } from '@/lib/backoffice/settings-client'
import { Card } from '@/components/backoffice/ui'
import { Toast } from '@/components/backoffice/controls'
import { Row, SettingsActions, numberClass } from './settings-ui'

/**
 * What the constancia costs (OOC-83). Next to the academic settings on screen,
 * and not one of them: saving writes a new version of the price
 * (`procedure_prices`), so it has its own button instead of going out in the
 * settings' PATCH. Requests already opened keep the amount they froze.
 */
export function ConstanciaPriceForm({ amountCents }: { amountCents: number }) {
  const t = useTranslations('bo')
  const locale = useLocale() as Locale
  const [saved, setSaved] = useState(amountCents)
  const [draft, setDraft] = useState(amountCents)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  async function save() {
    setSaving(true)
    const ok = await saveConstanciaPrice(draft)
    setSaving(false)
    if (!ok) {
      setToast(t('settings.save_failed_toast'))
      return
    }
    setSaved(draft)
    setToast(t('settings.constancia_fee_saved_toast'))
  }

  return (
    <section className="flex flex-col gap-3">
      <Card className="divide-y divide-line">
        <Row
          helpLabel={t('common.help')}
          label={t('settings.constancia_fee_label')}
          hint={t('settings.constancia_fee_hint')}
          value={formatMoney(draft, 'PEN', locale)}
        >
          <input
            type="number"
            min={1}
            max={1000}
            step={0.5}
            aria-label={t('settings.constancia_fee_label')}
            value={draft / 100}
            // Soles typed by hand are the only float in the flow, and it stops
            // on this line: what is stored is integer cents (CLAUDE.md §5).
            onChange={(event) => setDraft(Math.round(Number(event.target.value) * 100))}
            className={numberClass}
          />
        </Row>
      </Card>
      <SettingsActions dirty={draft !== saved} saving={saving} onSave={() => void save()} onCancel={() => setDraft(saved)} />
      {toast && <Toast message={toast} onDismiss={() => setToast(null)} />}
    </section>
  )
}
