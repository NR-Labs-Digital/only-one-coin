'use client'

import { useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import type { AcademicPeriodItem, CatalogErrorKey } from '@/lib/backoffice/types'
import { catalogWrite, setCatalogEntryOnOffer } from '@/lib/backoffice/catalog-client'
import { isoToLimaDate, limaDateToIso } from '@/lib/backoffice/lima-date'
import { formatDateRange, type Locale } from '@/lib/format'
import { BoIcon } from '@/components/backoffice/icons'
import { Toast } from '@/components/backoffice/controls'
import { HelpHint } from '@/components/backoffice/help-hint'
import { CatalogConfirmation, RetireConfirmation } from '@/components/backoffice/retire-confirmation'
import { AutoGrid } from '@/components/layout/auto-grid'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

const fieldClass =
  'rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink outline-none transition focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/15'

const labelClass = 'text-xs font-medium uppercase tracking-wide text-muted-foreground'

const primaryButtonClass =
  'inline-flex min-h-tap items-center gap-1.5 rounded-lg bg-brand-blue px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-brand-blue-deep disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-brand-blue'

const secondaryButtonClass =
  'inline-flex min-h-tap items-center gap-1.5 rounded-lg border border-line bg-white px-3.5 py-2 text-sm font-semibold text-muted-foreground transition hover:text-ink'

const menuItemClass = 'min-h-tap gap-2 px-3 text-sm'

type Mode = 'idle' | 'new' | 'copy' | 'edit' | 'retire' | 'restore'

/**
 * Which sales period the class group list shows, and the two ways a period is
 * born: from scratch, or carrying the previous one's class groups as drafts.
 *
 * It sits in the list's toolbar, first, as the filter it is — it used to be a
 * card of its own between the tabs and the toolbar, with the management
 * buttons beside the select, and read as a form rather than as the thing that
 * narrows the list. Managing periods is occasional, so it folds into a menu
 * and its forms open in a dialog.
 *
 * The period lives in the URL (`?period=`), not in state: a link to "the
 * class groups of 2027-I" has to open on 2027-I, and the server reads only
 * that period's class groups instead of the whole history.
 *
 * Creating and copying are two writes, not one. If the copy fails after the
 * period exists, the period stays — and an empty period offers "copy class
 * groups into this period", which is the same second step on its own.
 *
 * The selected period can also be renamed or re-dated, and taken off the
 * catalog or put back (OOC-70). Retiring a period takes its class groups off
 * the checkout without touching them; it is never blocked by the enrollments
 * still standing on it — the confirmation says how many there are before the
 * click (CLAUDE.md §1, "avisa, não bloqueia").
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
    // Editing starts from what the period holds now, as Lima reads the dates.
    setName(next === 'edit' && selected ? selected.name : '')
    setStartsOn(next === 'edit' && selected ? isoToLimaDate(selected.startsOn) : '')
    setEndsOn(next === 'edit' && selected ? isoToLimaDate(selected.endsOn) : '')
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
      // groups into this period" in the menu — and say why the copy failed.
      // The dialog closes with it, so the reason travels in the notice.
      if (!copied.ok) {
        setSaving(false)
        close()
        setToast(t('periods.copy_failed', { reason: t(`catalog_errors.${copied.error}`) }))
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

  async function editSelected() {
    if (!selected || !readyToCreate) return
    // Only what changed travels — the audit line names those fields.
    const patch = {
      ...(name.trim() !== selected.name && { name: name.trim() }),
      ...(startsOn !== isoToLimaDate(selected.startsOn) && { startsOn: limaDateToIso(startsOn) }),
      ...(endsOn !== isoToLimaDate(selected.endsOn) && { endsOn: limaDateToIso(endsOn) }),
    }
    if (Object.keys(patch).length === 0) return close()
    setSaving(true)
    setError(null)
    const result = await catalogWrite(`/periods/${selected.id}`, 'PATCH', patch)
    if (!result.ok) return fail(result.error)
    setSaving(false)
    close()
    setToast(t('periods.saved'))
    router.refresh()
  }

  async function setSelectedOnCatalog(verb: 'retire' | 'restore') {
    if (!selected) return
    setSaving(true)
    setError(null)
    const result = await setCatalogEntryOnOffer('academic_period', selected.id, verb)
    if (!result.ok) return fail(result.error)
    setSaving(false)
    close()
    setToast(
      verb === 'retire'
        ? t('periods.retired_notice', { count: result.data.liveEnrollments })
        : t('periods.restored'),
    )
    router.refresh()
  }

  const dialogTitle: Record<Exclude<Mode, 'idle'>, string> = {
    new: t('periods.new'),
    edit: t('periods.edit'),
    copy: t('periods.copy_into_existing'),
    retire: t('periods.retire'),
    restore: t('periods.restore'),
  }

  /** Name and the two dates — the same fields to open a period and to correct one. */
  const periodFields = (
    <>
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
    </>
  )

  return (
    <>
      {periods.length === 0 ? (
        <span className="text-sm text-muted-foreground">{t('periods.empty')}</span>
      ) : (
        /* The period is a sales campaign, not when classes start — the two
           read alike and got mixed up (OOC-93); the hint rides behind a (?)
           so the toolbar stays one line (OOC-133). */
        <div className="flex min-w-72 max-w-lg flex-1 items-center gap-2">
          <label className="relative flex min-w-0 flex-1">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t('periods.short_label')}
            </span>
            <select
              value={selectedId ?? ''}
              onChange={(event) => {
                close()
                go(event.target.value)
              }}
              aria-label={t('periods.label')}
              className={`${fieldClass} min-h-tap w-full truncate pl-20 font-semibold`}
            >
              {periods.map((period) => (
                <option key={period.id} value={period.id}>
                  {periodLabel(period)}
                </option>
              ))}
            </select>
          </label>
          <HelpHint what={t('periods.hint')} how={t(canManage ? 'help.period_how_manage' : 'help.period_how_read')} />
        </div>
      )}

      {canManage && (
        <DropdownMenu>
          <DropdownMenuTrigger className={`${secondaryButtonClass} data-[state=open]:text-ink`}>
            <BoIcon name="settings" size={16} />
            {t('periods.manage')}
            <BoIcon name="chevron-down" size={14} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64 p-1.5">
            <DropdownMenuItem className={menuItemClass} onSelect={() => open('new')}>
              <BoIcon name="plus" size={16} />
              {t('periods.new')}
            </DropdownMenuItem>
            {canCopyInto && (
              <DropdownMenuItem className={menuItemClass} onSelect={() => open('copy')}>
                <BoIcon name="doc" size={16} />
                {t('periods.copy_into_existing')}
              </DropdownMenuItem>
            )}
            {selected && selected.active && (
              <DropdownMenuItem className={menuItemClass} onSelect={() => open('edit')}>
                <BoIcon name="edit" size={16} />
                {t('periods.edit')}
              </DropdownMenuItem>
            )}
            {selected && (
              <>
                <DropdownMenuSeparator />
                {/* A retired period only offers to come back, like a retired class group. */}
                {selected.active ? (
                  <DropdownMenuItem
                    className={`${menuItemClass} text-red-700 focus:text-red-700`}
                    onSelect={() => open('retire')}
                  >
                    <BoIcon name="close" size={16} />
                    {t('periods.retire')}
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem className={menuItemClass} onSelect={() => open('restore')}>
                    <BoIcon name="check" size={16} />
                    {t('periods.restore')}
                  </DropdownMenuItem>
                )}
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      <Dialog
        open={mode !== 'idle'}
        onOpenChange={(isOpen) => {
          if (!isOpen && !saving) close()
        }}
      >
        <DialogContent closeLabel={t('periods.cancel')} className="bg-white">
          {mode !== 'idle' && (
            <DialogHeader className="border-b border-line p-5 pr-14">
              <DialogTitle className="text-base font-semibold text-ink">{dialogTitle[mode]}</DialogTitle>
              {selected && mode !== 'new' && <DialogDescription>{selected.name}</DialogDescription>}
            </DialogHeader>
          )}
          <div className="flex flex-col gap-4 p-5">
      {mode === 'new' && (
        <div>
          <AutoGrid min="13rem" gap="gap-3">
            {periodFields}
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

      {mode === 'edit' && selected && (
        <div>
          <AutoGrid min="13rem" gap="gap-3">
            {periodFields}
          </AutoGrid>
          <p className="mt-2 text-xs text-muted-foreground">{t('periods.edit_hint')}</p>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={!readyToCreate || saving}
              onClick={() => void editSelected()}
              className={primaryButtonClass}
            >
              <BoIcon name="check" size={16} />
              {t('periods.save')}
            </button>
            <button type="button" onClick={close} className={secondaryButtonClass}>
              {t('periods.cancel')}
            </button>
          </div>
        </div>
      )}

      {mode === 'retire' && selected && (
        <RetireConfirmation
          kind="academic_period"
          id={selected.id}
          text={t('periods.confirm_retire', { name: selected.name })}
          pending={saving}
          onConfirm={() => void setSelectedOnCatalog('retire')}
          onCancel={close}
        />
      )}

      {mode === 'restore' && selected && (
        <CatalogConfirmation
          text={t('periods.confirm_restore', { name: selected.name })}
          pending={saving}
          onConfirm={() => void setSelectedOnCatalog('restore')}
          onCancel={close}
        />
      )}

      {mode === 'copy' && selected && (
        <div>
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
          </div>
        </DialogContent>
      </Dialog>

      <Toast message={toast} onDismiss={() => setToast(null)} />
    </>
  )
}
