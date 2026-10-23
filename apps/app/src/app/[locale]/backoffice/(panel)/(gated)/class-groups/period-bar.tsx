'use client'

import { useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import type { AcademicPeriodItem, CatalogErrorKey } from '@/lib/backoffice/types'
import { catalogWrite } from '@/lib/backoffice/catalog-client'
import { limaDateToIso } from '@/lib/backoffice/lima-date'
import { formatDateRange, type Locale } from '@/lib/format'
import { Card } from '@/components/backoffice/ui'
import { BoIcon } from '@/components/backoffice/icons'
import { Toast } from '@/components/backoffice/controls'
import { AutoGrid } from '@/components/layout/auto-grid'

const fieldClass =
  'rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink outline-none transition focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/15'

const labelClass = 'text-xs font-medium uppercase tracking-wide text-muted-foreground'

const primaryButtonClass =
  'inline-flex min-h-tap items-center gap-1.5 rounded-lg bg-brand-blue px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-brand-blue-deep disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-brand-blue'

const secondaryButtonClass =
  'inline-flex min-h-tap items-center gap-1.5 rounded-lg border border-line bg-white px-3.5 py-2 text-sm font-semibold text-muted-foreground transition hover:text-ink'

type Mode = 'idle' | 'new' | 'copy'

/**
 * Which sales period the class group list shows, and the two ways a period is
 * born: from scratch, or carrying the previous one's class groups as drafts.
 *
 * The period lives in the URL (`?period=`), not in state: a link to "the
 * class groups of 2027-I" has to open on 2027-I, and the server reads only
 * that period's class groups instead of the whole history.
 *
 * Creating and copying are two writes, not one. If the copy fails after the
 * period exists, the period stays — and an empty period offers "copy class
 * groups into this period", which is the same second step on its own.
 */
export function PeriodBar({
  periods,
  selectedId,
  canManage,
}: {
  periods: AcademicPeriodItem[]
  selectedId: string | null
  canManage: boolean
}) {
  const t = useTranslations('bo')
  const locale = useLocale() as Locale
  const router = useRouter()
  const pathname = usePathname()

  const [mode, setMode] = useState<Mode>('idle')
  const [name, setName] = useState('')
  const [startsOn, setStartsOn] = useState('')
  const [endsOn, setEndsOn] = useState('')
  const [copyFrom, setCopyFrom] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<CatalogErrorKey | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const selected = periods.find((period) => period.id === selectedId) ?? null
  const sources = periods.filter((period) => period.id !== selectedId)
  /** Only an empty period takes a copy — the API refuses a second one anyway. */
  const canCopyInto =
    canManage && selected !== null && selected.classGroupCount === 0 && sources.length > 0

  const periodLabel = (period: AcademicPeriodItem) => {
    const range = formatDateRange(period.startsOn, period.endsOn, locale)
    return period.active
      ? `${period.name} · ${range}`
      : `${period.name} · ${range} · ${t('class_groups.retired')}`
  }

  function go(id: string) {
    router.push(`${pathname}?period=${encodeURIComponent(id)}`)
  }

  function open(next: Mode) {
    setMode(next)
    setError(null)
    setCopyFrom(next === 'copy' ? (sources[0]?.id ?? '') : '')
  }

  function close() {
    setMode('idle')
    setName('')
    setStartsOn('')
    setEndsOn('')
    setCopyFrom('')
    setError(null)
  }

  function fail(key: CatalogErrorKey) {
    setSaving(false)
    setError(key)
  }

  const readyToCreate = name.trim() !== '' && startsOn !== '' && endsOn !== ''

  async function createPeriod() {
    // The button is disabled until both dates exist, so neither helper ever
    // sees an empty string — but the guard costs nothing.
    if (!readyToCreate) return
    setSaving(true)
    setError(null)
    const created = await catalogWrite('/periods', 'POST', {
      name: name.trim(),
      startsOn: limaDateToIso(startsOn),
      endsOn: limaDateToIso(endsOn),
    })
    if (!created.ok) return fail(created.error)
    if (copyFrom) {
      const copied = await catalogWrite<{ copied: number; skippedRetired: number }>(
        `/periods/${created.data.id}/duplicate`,
        'POST',
        { sourcePeriodId: copyFrom },
      )
      // The period exists; go to it anyway — empty, it offers "copy class
      // groups into this period" — and keep the reason the copy failed on
      // screen.
      if (!copied.ok) {
        close()
        fail(copied.error)
        go(created.data.id)
        router.refresh()
        return
      }
      setToast(
        t('periods.copied', {
          copied: copied.data.copied,
          skipped: copied.data.skippedRetired,
        }),
      )
    } else {
      setToast(t('periods.created'))
    }
    setSaving(false)
    close()
    go(created.data.id)
    router.refresh()
  }

  async function copyIntoSelected() {
    if (!selected || !copyFrom) return
    setSaving(true)
    setError(null)
    const copied = await catalogWrite<{ copied: number; skippedRetired: number }>(
      `/periods/${selected.id}/duplicate`,
      'POST',
      { sourcePeriodId: copyFrom },
    )
    if (!copied.ok) return fail(copied.error)
    setSaving(false)
    close()
    setToast(
      t('periods.copied_into', {
        copied: copied.data.copied,
        skipped: copied.data.skippedRetired,
      }),
    )
    router.refresh()
  }

  return (
    <Card className="flex flex-col gap-4 p-4">
      <div className="flex flex-wrap items-end gap-3">
        {periods.length === 0 ? (
          <p className="flex min-h-tap flex-1 items-center text-sm text-muted-foreground">
            {t('periods.empty')}
          </p>
        ) : (
          <label className="flex min-w-60 max-w-md flex-1 flex-col gap-1">
            <span className={labelClass}>{t('periods.label')}</span>
            <select
              value={selectedId ?? ''}
              onChange={(event) => {
                setError(null)
                go(event.target.value)
              }}
              className={`${fieldClass} min-h-tap`}
            >
              {periods.map((period) => (
                <option key={period.id} value={period.id}>
                  {periodLabel(period)}
                </option>
              ))}
            </select>
            {/* The period is a sales campaign, not when classes start — the
                two read alike and got mixed up (OOC-93). */}
            <span className="text-xs text-muted-foreground">{t('periods.hint')}</span>
          </label>
        )}

        {canManage && mode === 'idle' && (
          <div className="flex flex-wrap gap-2">
            {canCopyInto && (
              <button type="button" onClick={() => open('copy')} className={secondaryButtonClass}>
                <BoIcon name="doc" size={16} />
                {t('periods.copy_into_existing')}
              </button>
            )}
            <button type="button" onClick={() => open('new')} className={secondaryButtonClass}>
              <BoIcon name="plus" size={16} />
              {t('periods.new')}
            </button>
          </div>
        )}
      </div>

      {mode === 'new' && (
        <div className="border-t border-line pt-4">
          <p className="mb-3 text-sm font-semibold text-ink">{t('periods.new')}</p>
          <AutoGrid min="13rem" gap="gap-3">
            <label className="flex flex-col gap-1">
              <span className={labelClass}>{t('periods.name')}</span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={t('periods.name_placeholder')}
                className={fieldClass}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className={labelClass}>{t('periods.starts')}</span>
              <input
                type="date"
                value={startsOn}
                onChange={(event) => setStartsOn(event.target.value)}
                className={fieldClass}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className={labelClass}>{t('periods.ends')}</span>
              <input
                type="date"
                value={endsOn}
                onChange={(event) => setEndsOn(event.target.value)}
                className={fieldClass}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className={labelClass}>{t('periods.copy_from')}</span>
              <select
                value={copyFrom}
                onChange={(event) => setCopyFrom(event.target.value)}
                className={fieldClass}
              >
                <option value="">{t('periods.copy_none')}</option>
                {periods.map((period) => (
                  <option key={period.id} value={period.id}>
                    {periodLabel(period)}
                  </option>
                ))}
              </select>
            </label>
          </AutoGrid>
          {copyFrom && <p className="mt-2 text-xs text-muted-foreground">{t('periods.copy_hint')}</p>}

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={!readyToCreate || saving}
              onClick={() => void createPeriod()}
              className={primaryButtonClass}
            >
              <BoIcon name="check" size={16} />
              {t('periods.create')}
            </button>
            <button type="button" onClick={close} className={secondaryButtonClass}>
              {t('periods.cancel')}
            </button>
          </div>
        </div>
      )}

      {mode === 'copy' && selected && (
        <div className="border-t border-line pt-4">
          <p className="mb-3 text-sm font-semibold text-ink">{t('periods.copy_into_existing')}</p>
          <label className="flex max-w-md flex-col gap-1">
            <span className={labelClass}>{t('periods.copy_from')}</span>
            <select
              value={copyFrom}
              onChange={(event) => setCopyFrom(event.target.value)}
              className={fieldClass}
            >
              {sources.map((period) => (
                <option key={period.id} value={period.id}>
                  {periodLabel(period)}
                </option>
              ))}
            </select>
          </label>
          <p className="mt-2 text-xs text-muted-foreground">{t('periods.copy_hint')}</p>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={!copyFrom || saving}
              onClick={() => void copyIntoSelected()}
              className={primaryButtonClass}
            >
              <BoIcon name="check" size={16} />
              {t('periods.copy')}
            </button>
            <button type="button" onClick={close} className={secondaryButtonClass}>
              {t('periods.cancel')}
            </button>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm text-red-700">
          {t(`catalog_errors.${error}`)}
        </p>
      )}

      <Toast message={toast} onDismiss={() => setToast(null)} />
    </Card>
  )
}
