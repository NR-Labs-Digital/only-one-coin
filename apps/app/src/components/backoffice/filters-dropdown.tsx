'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { BoIcon, type BoIconName } from './icons'

/**
 * The filter set of a list, folded into the button that opens it.
 *
 * It used to unfold as a full-width card between the toolbar and the table,
 * which pushed the rows down every time somebody went looking for one chip —
 * the list you are filtering moved while you filtered it. As a panel hanging
 * off its own button, the table stays where it was.
 *
 * Copy never lives here — the label arrives translated from the caller (i18n
 * hard rule, CLAUDE.md §4), and the controls inside are the caller's own.
 */
export function FiltersDropdown({
  label,
  count,
  icon = 'filter',
  panelClassName = 'flex-wrap items-center gap-1.5',
  children,
}: {
  label: string
  /** Filters currently narrowing the list — 0 hides the badge. */
  count: number
  /** The trigger's icon — `filter` unless the panel holds something else. */
  icon?: BoIconName
  /**
   * How the caller's own controls sit inside the panel — a wrap of chips, a
   * column of labelled rows, a line of selects. The panel owns the box, never
   * the arrangement: each list has a different filter set and forcing one
   * layout on all of them is what makes a shared component get copied instead.
   */
  panelClassName?: string
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  /* Click outside and Escape both close it: a panel that can only be dismissed
     by finding its own button again is a panel that stays open. */
  useEffect(() => {
    if (!open) return

    function onPointerDown(event: MouseEvent | TouchEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      setOpen(false)
      // Back to the trigger, or the focus ring is left nowhere.
      root.current?.querySelector('button')?.focus()
    }

    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-semibold transition ${
          count > 0 || open
            ? 'border-brand-blue bg-sky text-brand-blue'
            : 'border-line bg-white text-muted-foreground hover:text-ink'
        }`}
      >
        <BoIcon name={icon} size={16} />
        {label}
        {count > 0 && (
          <span className="rounded-full bg-brand-blue px-1.5 text-xs text-white">
            {count}
          </span>
        )}
        <BoIcon
          name="chevron-down"
          size={14}
          className={`transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        /* Anchored left, above the table. `w-max` lets it be as wide as its
           chips need and no wider, and the cap keeps it on screen on a narrow
           column. */
        <div
          className={cn(
            /* Box only. Direction, wrapping and alignment come from the
               caller: `tailwind-merge` cannot resolve `flex-col` against a
               default `items-center`, and the two together centre every row
               of a column layout. */
            'absolute left-0 top-full z-30 mt-2 flex w-max min-w-56 max-w-[min(32rem,calc(100vw-2rem))] rounded-xl border border-line bg-white p-3 shadow-lg',
            panelClassName,
          )}
        >
          {children}
        </div>
      )}
    </div>
  )
}
