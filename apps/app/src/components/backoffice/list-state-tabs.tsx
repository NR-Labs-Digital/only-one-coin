'use client'

export interface ListStateTab<K extends string> {
  key: K
  label: string
  /** From the server, under the reader's other filters. */
  count: number
}

/**
 * The cut a list makes between what still needs work and what is done
 * (OOC-113) — GitHub's `Open 12 · Closed 340`. The list opens on the first
 * tab, and every tab carries its count, so the one not on screen still says
 * what is behind it.
 *
 * A segmented row, not the browser-style strip of `tab-strip.ts`: that strip
 * already names the section's screens right above, and two rows of the same
 * tabs read as two levels of navigation. Buttons, not links — the caller owns
 * the URL and the transition that dims the table while the page loads.
 */
export function ListStateTabs<K extends string>({
  tabs,
  active,
  onSelect,
  label,
}: {
  tabs: ListStateTab<K>[]
  active: K
  onSelect: (key: K) => void
  /** What the row cuts, for screen readers. */
  label: string
}) {
  return (
    /* `overflow-x-auto`: on a 343px phone three labels with counts may not
       fit, and the row scrolls instead of widening the page (CLAUDE.md §5). */
    <div
      role="tablist"
      aria-label={label}
      className="flex max-w-full items-center gap-1 self-start overflow-x-auto rounded-xl border border-line bg-slate-100 p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {tabs.map((tab) => {
        const selected = tab.key === active
        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onSelect(tab.key)}
            className={`flex min-h-tap shrink-0 items-center gap-2 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-semibold transition ${
              selected
                ? 'bg-white text-ink shadow-sm'
                : 'text-muted-foreground hover:bg-white/60 hover:text-ink'
            }`}
          >
            {tab.label}
            <span
              className={`grid h-5 min-w-5 place-items-center rounded-full px-1.5 text-[11px] font-bold tabular-nums ${
                selected ? 'bg-brand-blue text-white' : 'bg-slate-200 text-muted-foreground'
              }`}
            >
              {tab.count}
            </span>
          </button>
        )
      })}
    </div>
  )
}
