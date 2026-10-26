'use client'

import { useEffect, useRef, useTransition } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { usePathname, useRouter } from '@/i18n/navigation'
import { routing } from '@/i18n/routing'
import { CheckoutIcon } from './icons'

/**
 * Language switcher for the public checkout — the landing's pill, rebuilt.
 *
 * It matches the marketing site on purpose: this is the screen somebody lands
 * on straight from there, and a control that changes shape between the two
 * reads as a different site. Globe, the code in caps, a chevron that turns.
 *
 * Its own copy rather than the portal's for one reason beyond looks: **it has
 * to keep the query string.** `usePathname()` returns the path without the
 * search params, so `router.replace(pathname, …)` silently drops
 * `?course=&group=&src=`. Here that is not cosmetic — it discards the seller's
 * prefill and rewrites `source` from `whatsapp` back to `web`, corrupting the
 * channel attribution that is the whole reason the two entry modes share one
 * wizard (`docs/MATRICULA-CHECKOUT.md` §1 and §4).
 *
 * Read from `window.location` at click time rather than through
 * `useSearchParams`, which would opt every statically rendered page under this
 * layout into client rendering for a value only this handler needs.
 *
 * Built on `<details>` like the landing's, so it costs no dropdown library on
 * the one page a stranger opens on mobile data — plus the two things a bare
 * `<details>` does not do on its own: close on an outside click, and close on
 * Escape.
 */
export function LanguageSwitcher() {
  const t = useTranslations('language')
  const locale = useLocale()
  const pathname = usePathname()
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const box = useRef<HTMLDetailsElement>(null)

  useEffect(() => {
    function close(event: Event) {
      const el = box.current
      if (!el?.open) return
      if (event instanceof KeyboardEvent) {
        if (event.key === 'Escape') el.open = false
        return
      }
      if (!el.contains(event.target as Node)) el.open = false
    }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', close)
    return () => {
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('keydown', close)
    }
  }, [])

  function pick(next: string) {
    if (box.current) box.current.open = false
    // The query is the seller's link. Losing it here loses the prefill and,
    // worse, the channel the enrollment came from.
    const search = typeof window === 'undefined' ? '' : window.location.search
    startTransition(() => {
      router.replace(`${pathname}${search}`, { locale: next })
    })
  }

  return (
    <details ref={box} className="group relative">
      <summary
        aria-label={t('label')}
        className="inline-flex cursor-pointer list-none items-center gap-2 rounded-full border-[1.5px] border-line bg-white px-3.5 py-2 text-[0.8125rem] font-bold text-ink transition hover:border-brand-blue hover:text-brand-blue [&::-webkit-details-marker]:hidden"
      >
        <CheckoutIcon name="globe" size={18} className="text-brand-blue" />
        <span>{locale.toUpperCase()}</span>
        <CheckoutIcon
          name="chevron-down"
          size={14}
          className="transition-transform group-open:rotate-180"
        />
      </summary>

      <ul className="absolute right-0 top-[calc(100%+0.5rem)] z-50 min-w-[10.5rem] list-none rounded-2xl border border-line bg-white p-1.5 shadow-float">
        {routing.locales.map((code) => {
          const active = code === locale
          return (
            <li key={code}>
              <button
                type="button"
                lang={code}
                disabled={pending}
                aria-current={active ? 'true' : undefined}
                onClick={() => pick(code)}
                className={`flex w-full items-center gap-2.5 rounded-[0.625rem] px-3 py-2.5 text-left font-semibold transition ${
                  active
                    ? 'bg-sky text-brand-blue'
                    : 'text-muted-foreground hover:bg-sky hover:text-ink'
                }`}
              >
                <span className="w-[1.625rem] text-[0.6875rem] font-extrabold tracking-wide text-brand-blue">
                  {code.toUpperCase()}
                </span>
                <span className="text-sm">{t(code)}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </details>
  )
}
