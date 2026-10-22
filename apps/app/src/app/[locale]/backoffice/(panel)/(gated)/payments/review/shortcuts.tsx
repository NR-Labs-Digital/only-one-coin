'use client'

import { useTranslations } from 'next-intl'

/**
 * The review queue's keyboard (ROADMAP Sessão 32: 25 reviews in a row
 * without the mouse). Letters, not words, so they hold in every locale:
 * A approves, R rejects, I is the image, L reads again ("leer"/"ler"), J/K
 * walk the list. No shortcut does more than the button it stands for — A is
 * the approve click, R only opens the rejection form, and the rejection still
 * needs its own confirmation.
 */

/** Key caps are the keyboard's own names, the same in every locale. */
export const KEY_CTRL = 'Ctrl'
export const KEY_ENTER = 'Enter'

/** One line of the legend: the keys, and the locale key of what they do. */
interface Shortcut {
  keys: string[]
  label: string
}

export const QUEUE_SHORTCUTS: Shortcut[] = [
  { keys: ['J', '↓'], label: 'shortcuts.queue_next' },
  { keys: ['K', '↑'], label: 'shortcuts.queue_prev' },
  { keys: [KEY_ENTER, 'O'], label: 'shortcuts.queue_open' },
  { keys: ['/'], label: 'shortcuts.queue_search' },
  { keys: ['?'], label: 'shortcuts.toggle' },
]

export const CASE_SHORTCUTS: Shortcut[] = [
  { keys: ['A'], label: 'shortcuts.case_approve' },
  { keys: ['R'], label: 'shortcuts.case_reject' },
  { keys: ['1–5'], label: 'shortcuts.case_reason' },
  { keys: ['N'], label: 'shortcuts.case_note' },
  { keys: [KEY_CTRL, KEY_ENTER], label: 'shortcuts.case_reject_confirm' },
  { keys: ['J', '→'], label: 'shortcuts.case_next' },
  { keys: ['K', '←'], label: 'shortcuts.case_prev' },
  { keys: ['I'], label: 'shortcuts.case_image' },
  { keys: ['L'], label: 'shortcuts.case_reread' },
  { keys: ['Esc'], label: 'shortcuts.case_escape' },
  { keys: ['?'], label: 'shortcuts.toggle' },
]

/**
 * Whether a key press belongs to whatever the reader is typing in. Every
 * `input` counts, radios included: an arrow key on a focused radio moves the
 * choice, and must not also move the case.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  return target.closest('input, textarea, select') !== null
}

/** A key cap. */
export function Kbd({ children }: { children: string }) {
  return (
    <kbd className="inline-flex min-w-6 items-center justify-center rounded border border-line bg-white px-1.5 py-0.5 font-mono text-[11px] font-semibold text-ink shadow-[0_1px_0_var(--color-line)]">
      {children}
    </kbd>
  )
}

/** The legend, as a list — the queue shows both groups, the case its own. */
export function ShortcutList({ title, shortcuts }: { title: string; shortcuts: Shortcut[] }) {
  const t = useTranslations('bo')
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
      <dl className="mt-2 grid gap-1.5">
        {shortcuts.map((shortcut) => (
          <div key={shortcut.label + shortcut.keys.join()} className="flex items-center justify-between gap-4 text-sm">
            <dt className="text-ink">{t(shortcut.label)}</dt>
            <dd className="flex shrink-0 items-center gap-1">
              {shortcut.keys.map((key) => (
                <Kbd key={key}>{key}</Kbd>
              ))}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
