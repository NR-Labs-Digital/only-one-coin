'use client'

import { useTransition } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { usePathname, useRouter } from '@/i18n/navigation'
import { routing } from '@/i18n/routing'
import { Card, SectionTitle } from '@/components/backoffice/ui'
import { BoIcon } from '@/components/backoffice/icons'

/**
 * The language the panel speaks in. Same switch as the globe in the header,
 * spelled out: on the account page the three options are the point, not a menu
 * to open. Adding a fourth language (quechua, CLAUDE.md §4) adds a row here
 * with no code change — the list comes from the routing config.
 *
 * It changes the route locale, so it takes effect at once and survives a
 * shared link. Persisting it on the user's row is part of wiring `apps/api`.
 */
export function AccountLanguage() {
  const t = useTranslations('bo')
  const languages = useTranslations('language')
  const locale = useLocale()
  const pathname = usePathname()
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  return (
    <Card className="flex flex-col p-5">
      <SectionTitle icon="globe">{t('account.language_title')}</SectionTitle>

      <ul className="mt-4 flex flex-col gap-1.5">
        {routing.locales.map((code) => {
          const active = code === locale
          return (
            <li key={code}>
              <button
                type="button"
                role="radio"
                aria-checked={active}
                disabled={pending}
                onClick={() => {
                  if (active) return
                  startTransition(() => {
                    router.replace(pathname, { locale: code })
                  })
                }}
                className={`flex w-full items-center gap-2.5 rounded-lg border px-3 py-2 text-left text-sm font-semibold transition disabled:opacity-60 ${
                  active
                    ? 'border-brand-blue bg-sky text-brand-blue-deep'
                    : 'border-line text-muted-foreground hover:border-brand-yellow hover:bg-cream hover:text-ink'
                }`}
              >
                <span className="w-7 text-[11px] font-extrabold tracking-wider text-brand-blue">
                  {code.toUpperCase()}
                </span>
                <span className="flex-1">{languages(code)}</span>
                {active && <BoIcon name="check" size={16} />}
              </button>
            </li>
          )
        })}
      </ul>
    </Card>
  )
}
