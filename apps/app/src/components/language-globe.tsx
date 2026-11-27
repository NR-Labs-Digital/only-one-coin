'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { usePathname, useRouter } from '@/i18n/navigation'
import { routing } from '@/i18n/routing'
import { savePreferredLocale } from '@/lib/preferred-locale'

/**
 * Language switcher shaped like the one on the landing: a pill with a globe and
 * the locale code, opening a small menu. `variant` adapts it to a light surface
 * (panel header) or a dark one (login banner).
 *
 * `saveToAccount` is for the signed-in shells (OOC-191): the switch also saves
 * the choice on the account, like the one on the account page (OOC-150), so the
 * next sign-in on any device opens in it. The login screens leave it off —
 * before signing in there is no account to save on.
 */
export function LanguageGlobe({
  variant = 'light',
  saveToAccount = false,
}: {
  variant?: 'light' | 'dark'
  saveToAccount?: boolean
}) {
  const t = useTranslations('language')
  const locale = useLocale()
  const pathname = usePathname()
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  // Close on outside click / Escape — the menu is not a native <select>.
  useEffect(() => {
    if (!open) return
    function onPointerDown(event: MouseEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const dark = variant === 'dark'

  function select(next: string) {
    setOpen(false)
    if (next === locale) return
    if (saveToAccount) void savePreferredLocale(next)
    startTransition(() => {
      router.replace(pathname, { locale: next })
    })
  }

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        disabled={pending}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('label')}
        className={`inline-flex ${saveToAccount ? 'min-h-tap' : ''} items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-bold transition disabled:opacity-60 ${
          dark
            ? 'border-white/15 bg-white/5 text-white hover:border-white/35'
            : 'border-line bg-white text-ink hover:border-brand-blue hover:text-brand-blue'
        }`}
      >
        <svg
          width={16}
          height={16}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className={dark ? 'text-brand-yellow' : 'text-brand-blue'}
        >
          <circle cx="12" cy="12" r="10" />
          <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
          <path d="M2 12h20" />
        </svg>
        {locale.toUpperCase()}
        <svg
          width={12}
          height={12}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className={`transition-transform ${open ? 'rotate-180' : ''}`}
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && (
        <ul
          role="menu"
          className={`absolute right-0 top-[calc(100%+8px)] z-50 min-w-[10.5rem] rounded-2xl border p-1.5 shadow-float ${
            dark ? 'border-white/10 bg-ink' : 'border-line bg-white'
          }`}
        >
          {routing.locales.map((code) => {
            const active = code === locale
            return (
              <li key={code} role="none">
                <button
                  type="button"
                  role="menuitemradio"
                  onClick={() => select(code)}
                  aria-checked={active}
                  className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm font-semibold transition ${
                    active
                      ? dark
                        ? 'bg-white/10 text-white'
                        : 'bg-sky text-brand-blue'
                      : dark
                        ? 'text-slate-300 hover:bg-white/5 hover:text-white'
                        : 'text-muted-foreground hover:bg-sky hover:text-ink'
                  }`}
                >
                  <span
                    className={`w-6 text-[11px] font-extrabold tracking-wider ${
                      dark ? 'text-brand-yellow' : 'text-brand-blue'
                    }`}
                  >
                    {code.toUpperCase()}
                  </span>
                  {t(code)}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
