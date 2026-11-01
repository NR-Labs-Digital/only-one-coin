'use client'

import { Link, usePathname } from '@/i18n/navigation'
import { tabClass, tabStripClass } from './tab-strip'

export interface SectionTab {
  href: string
  label: string
  /**
   * Lights the tab on its own path only. Needed when a section's index is the
   * parent of its siblings (`/payments` over `/payments/review`): the prefix
   * match would otherwise leave two tabs lit at once.
   */
  exact?: boolean
  /** A number beside the label — what is waiting behind the tab. */
  count?: number
}

/**
 * The two halves of a section that share one sidebar entry. Real routes, not
 * client state: a class group opened from a tab is still a link somebody can
 * bookmark or send to a colleague, and the detail pages under it keep their
 * own URLs.
 */
export function SectionTabs({ tabs }: { tabs: SectionTab[] }) {
  const pathname = usePathname()

  return (
    <nav className={tabStripClass}>
      {tabs.map((tab) => {
        /* The detail page of a class group belongs to the class group tab —
           matching the prefix keeps the tab lit while you are inside it. */
        const active = tab.exact
          ? pathname === tab.href
          : pathname === tab.href || pathname.startsWith(`${tab.href}/`)
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            className={tabClass(active)}
          >
            {tab.label}
            {tab.count !== undefined && (
              <span className={active ? 'text-brand-blue/60' : 'text-slate-400'}>{tab.count}</span>
            )}
          </Link>
        )
      })}
    </nav>
  )
}
