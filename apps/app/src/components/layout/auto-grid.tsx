import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * Grid that fits as many columns of at least `min` as the space it lands in —
 * with no breakpoint involved.
 *
 * Every `sm:grid-cols-2 xl:grid-cols-4` is a guess about the viewport, and a
 * screen inside a shell never gets the viewport: the backoffice sidebar takes
 * 13.5rem open and 3rem collapsed, the portal's takes 16rem, and the content
 * column is capped on top of that. One window width therefore means several
 * different columns, which is why a screen can look right on the monitor it
 * was built on and break two seats over.
 *
 * `auto-fit` asks the browser the only question that matters — how many of
 * these still fit here — and answers it again on every resize, on every
 * sidebar toggle, and on a monitor nobody has tested on yet.
 *
 * `min(…, 100%)` is the floor guard: without it a container narrower than
 * `min` overflows instead of dropping to a single column.
 *
 * New screens: reach for this before writing a `grid-cols-*` breakpoint.
 */
export function AutoGrid({
  min = '16rem',
  gap = 'gap-4',
  className,
  children,
  as: Tag = 'div',
  fill = false,
}: {
  /** Narrowest a column may get before the grid drops one. */
  min?: string
  /** Gap utilities, apart so an asymmetric `gap-x-*`/`gap-y-*` pair cannot
      collide with a default the caller never asked for. */
  gap?: string
  className?: string
  children: ReactNode
  as?: 'div' | 'section' | 'dl' | 'ul'
  /**
   * Keeps empty tracks instead of stretching the items into them (`auto-fill`).
   * For a short list of cards — one plan should stay a card, not a banner the
   * width of the screen.
   */
  fill?: boolean
}) {
  return (
    <Tag
      className={cn('grid', gap, className)}
      style={{ gridTemplateColumns: `repeat(${fill ? 'auto-fill' : 'auto-fit'}, minmax(min(${min}, 100%), 1fr))` }}
    >
      {children}
    </Tag>
  )
}

/**
 * Item that always takes the whole row of an `AutoGrid` — the replacement for
 * `sm:col-span-2`, which guesses a column count and spills into an implicit
 * extra column when the grid happens to be narrower than the guess.
 */
export const fullRowClass = 'col-span-full'
