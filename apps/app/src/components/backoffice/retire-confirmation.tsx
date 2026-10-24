'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import type { CatalogEntryKind } from '@/lib/backoffice/types'
import { readCatalogEntryState } from '@/lib/backoffice/catalog-client'
import { BoIcon } from '@/components/backoffice/icons'

const primaryButtonClass =
  'inline-flex min-h-tap items-center gap-1.5 rounded-lg bg-brand-blue px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-brand-blue-deep disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-brand-blue'

const secondaryButtonClass =
  'inline-flex min-h-tap items-center gap-1.5 rounded-lg border border-line bg-white px-3.5 py-2 text-sm font-semibold text-muted-foreground transition hover:text-ink disabled:cursor-not-allowed disabled:opacity-40'

export type LiveEnrollments =
  | { status: 'loading' }
  | { status: 'ready'; count: number }
  | { status: 'failed' }

/**
 * How many enrollments the entry still carries, read while `enabled` — the
 * moment someone is about to retire it (OOC-70). Re-read on every opening:
 * the count moves as payments are approved.
 */
export function useLiveEnrollments(
  kind: CatalogEntryKind,
  id: string,
  enabled: boolean,
): LiveEnrollments {
  const [state, setState] = useState<LiveEnrollments>({ status: 'loading' })

  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    setState({ status: 'loading' })
    void readCatalogEntryState(kind, id, controller.signal).then((answer) => {
      if (controller.signal.aborted) return
      setState(answer ? { status: 'ready', count: answer.liveEnrollments } : { status: 'failed' })
    })
    return () => controller.abort()
  }, [kind, id, enabled])

  return state
}

/**
 * The warning CLAUDE.md §1 asks for when something leaves the catalog: how
 * many enrollments are still standing on it. It informs, it never blocks — a
 * count that could not be read says so and still lets the person go on.
 */
export function LiveEnrollmentsNotice({ state }: { state: LiveEnrollments }) {
  const t = useTranslations('bo')

  if (state.status === 'loading') {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {t('catalog_retire.counting')}
      </p>
    )
  }

  if (state.status === 'failed') {
    return (
      <p role="status" className="flex items-start gap-2 text-sm text-muted-foreground">
        <BoIcon name="alert" size={14} className="mt-0.5 shrink-0" />
        {t('catalog_retire.count_failed')}
      </p>
    )
  }

  if (state.count === 0) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {t('catalog_retire.none_live')}
      </p>
    )
  }

  return (
    <p
      role="status"
      className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"
    >
      <BoIcon name="alert" size={16} className="mt-0.5 shrink-0" />
      {t('catalog_retire.live', { count: state.count })}
    </p>
  )
}

/**
 * The inline "are you sure" before taking a catalog entry off the shelf. The
 * confirm button waits for the count, so the warning is read before the
 * decision and not only in the toast after it.
 */
export function RetireConfirmation({
  kind,
  id,
  text,
  pending,
  onConfirm,
  onCancel,
}: {
  kind: CatalogEntryKind
  id: string
  /** What leaving the catalog means for this kind of entry. */
  text: string
  pending: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  const live = useLiveEnrollments(kind, id, true)

  return (
    <CatalogConfirmation
      text={text}
      pending={pending || live.status === 'loading'}
      onConfirm={onConfirm}
      onCancel={onCancel}
    >
      <LiveEnrollmentsNotice state={live} />
    </CatalogConfirmation>
  )
}

/** The same inline box, for a step that needs no count — putting an entry back. */
export function CatalogConfirmation({
  text,
  pending,
  onConfirm,
  onCancel,
  children,
}: {
  text: string
  pending: boolean
  onConfirm: () => void
  onCancel: () => void
  children?: ReactNode
}) {
  const t = useTranslations('bo')

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-line bg-sky-soft px-4 py-3">
      <p className="text-sm text-ink">{text}</p>
      {children}
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={pending} onClick={onConfirm} className={primaryButtonClass}>
          {t('catalog_retire.confirm')}
        </button>
        <button type="button" onClick={onCancel} className={secondaryButtonClass}>
          {t('catalog_retire.cancel')}
        </button>
      </div>
    </div>
  )
}
