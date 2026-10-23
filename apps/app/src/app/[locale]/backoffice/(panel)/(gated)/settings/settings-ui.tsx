'use client'

import { useState, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import type { PlatformSettings } from '@/lib/backoffice/platform-settings'
import { changedSettings, saveSettings } from '@/lib/backoffice/settings-client'
import { BoIcon } from '@/components/backoffice/icons'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

export const numberClass =
  'w-32 rounded-lg border border-line bg-white px-3 py-2 text-sm tabular-nums text-ink outline-none transition focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/15'

/**
 * Label, what the value currently reads as, and the control — with the reason
 * the setting exists folded into a `?` beside the label.
 *
 * Folded rather than printed: these rows are read by someone who already knows
 * what a tolerance is and comes here to change a number, and four paragraphs of
 * explanation between them turns a four-line list into a page of scrolling. The
 * explanation still has to be reachable, though — a number nobody can justify is
 * a number nobody dares touch — so it is one hover or one tab-stop away, never
 * deleted.
 *
 * The rendered value sits apart from the input on purpose: a fee typed as `25`
 * has to be read back as money before anybody agrees to it.
 */
export function Row({
  label,
  hint,
  helpLabel,
  value,
  children,
}: {
  label: string
  hint: string
  /** Names the `?` for a screen reader; the hint itself is the description. */
  helpLabel: string
  value: string
  children: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 p-4">
      <span className="flex min-w-64 flex-1 items-center gap-1.5">
        <span className="text-sm font-semibold text-ink">{label}</span>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="shrink-0 rounded-full text-muted-foreground transition hover:text-brand-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/40"
            >
              <BoIcon name="help" size={15} />
              <span className="sr-only">{helpLabel}</span>
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={6} className="max-w-xs leading-relaxed">
            {hint}
          </TooltipContent>
        </Tooltip>
      </span>
      <span className="flex shrink-0 items-center gap-3">
        <span className="w-32 text-right text-sm font-semibold tabular-nums text-ink">
          {value}
        </span>
        {children}
      </span>
    </div>
  )
}

/** Inline note under the block — the rule behind the fields, not a field. */
export function Notice({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-start gap-2 rounded-lg border border-dashed border-line bg-sky-soft px-3 py-2 text-xs text-muted-foreground">
      <BoIcon name="alert" size={14} className="mt-0.5 shrink-0" />
      {children}
    </p>
  )
}

/** Save/discard pair every settings screen ends on. Disabled until dirty. */
export function SettingsActions({
  dirty,
  saving = false,
  onSave,
  onCancel,
}: {
  dirty: boolean
  /** While the save is on its way both buttons wait — a second click would
   * send the same change twice. */
  saving?: boolean
  onSave: () => void
  onCancel: () => void
}) {
  const t = useTranslations('bo')

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={!dirty || saving}
        aria-busy={saving}
        onClick={onSave}
        className="inline-flex items-center gap-1.5 rounded-lg bg-brand-blue px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-brand-yellow hover:text-ink active:bg-brand-yellow-deep disabled:cursor-not-allowed disabled:opacity-40"
      >
        <BoIcon name="check" size={16} />
        {t('settings.save')}
      </button>
      <button
        type="button"
        disabled={!dirty || saving}
        onClick={onCancel}
        className="rounded-lg border border-line px-3.5 py-2 text-sm font-semibold text-muted-foreground transition hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
      >
        {t('settings.cancel')}
      </button>
    </div>
  )
}

/**
 * One settings form's state: what the server holds, what the reader is typing,
 * and the save that turns one into the other (`PATCH /settings`, OOC-41).
 * Only the fields that changed are sent, all in one call — the server applies
 * all of them or none, so the screen never ends up half saved.
 */
export function useSettingsForm<T extends Partial<PlatformSettings>>(initial: T) {
  const t = useTranslations('bo')
  const [saved, setSaved] = useState<T>(initial)
  const [draft, setDraft] = useState<T>(initial)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  const dirty = JSON.stringify(draft) !== JSON.stringify(saved)

  function set<K extends keyof T>(key: K, value: T[K]) {
    setDraft((current) => ({ ...current, [key]: value }))
  }

  async function save() {
    setSaving(true)
    const result = await saveSettings(changedSettings(saved, draft))
    setSaving(false)
    if (!result) {
      setToast(t('settings.save_failed_toast'))
      return
    }
    setSaved(draft)
    setToast(t('settings.saved_toast'))
  }

  return {
    draft,
    set,
    dirty,
    saving,
    toast,
    dismissToast: () => setToast(null),
    save: () => void save(),
    cancel: () => setDraft(saved),
  }
}
