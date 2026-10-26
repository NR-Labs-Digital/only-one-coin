import type { ReactNode } from 'react'
import Image from 'next/image'
import { getTranslations } from 'next-intl/server'
import { LanguageGlobe } from '@/components/language-globe'
import { ArrowLeftIcon } from '@/components/backoffice/auth-icons'

/**
 * Which door this screen is. Each keeps the colour it had as a split panel,
 * so nobody mistakes one login for another: navy for the backoffice, blue for
 * the student portal and for the teacher portal, which also wears its badge.
 */
export type AuthDoor = 'student' | 'staff' | 'teacher'

const bandClass: Record<AuthDoor, string> = {
  student: 'bg-brand-blue',
  staff: 'bg-ink',
  teacher: 'bg-brand-blue',
}

/** The student form carries the "no account yet" block, so it gets more room. */
const columnClass: Record<AuthDoor, string> = {
  student: 'max-w-md',
  staff: 'max-w-sm',
  teacher: 'max-w-sm',
}

/**
 * The frame of every sign-in screen, in the banner model the client asked for
 * (OOC-127): a full-width brand band on top — the mark with a welcome bubble,
 * the language switcher, the way back to the site — and the form centred on
 * the page below it. It replaced the split layout (brand panel beside the
 * form), which existed only on desktop; the band stays on the phone too, so
 * the screen reads as the same product at any width.
 *
 * Shared by the three doors (student, backoffice, teacher), so it lives here
 * and not in any one route folder (`apps/app/CLAUDE.md`, shared code).
 */
export async function AuthBannerLayout({
  door,
  badge,
  backToSite,
  children,
}: {
  door: AuthDoor
  /** Short label beside the mark — the teacher portal's "Docente". */
  badge?: string
  /** Only the student door links back to the landing; staff doors are never linked from it. */
  backToSite?: { href: string; label: string }
  children: ReactNode
}) {
  const t = await getTranslations('auth_banner')

  return (
    <div className="flex min-h-dvh flex-col bg-sky-soft font-body">
      <header className={`relative overflow-hidden pt-safe-t ${bandClass[door]}`}>
        {/* The landing hero's decoration, toned down: a yellow wash high on the
            right and the dot grid. Enough that the band is not a flat stripe. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -right-24 -top-40 h-80 w-80 rounded-full bg-brand-yellow/25 blur-3xl"
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-[0.12]"
          style={{
            backgroundImage: 'radial-gradient(#ffffff 2.2px, transparent 2.2px)',
            backgroundSize: '22px 22px',
          }}
        />

        <div className="relative mx-auto flex w-full max-w-5xl items-center justify-between gap-3 px-4 pt-3 sm:px-6">
          {backToSite ? (
            <a
              href={backToSite.href}
              className="inline-flex min-h-tap items-center gap-1.5 rounded-full px-2 text-sm font-semibold text-white/80 transition hover:text-white"
            >
              <ArrowLeftIcon size={16} />
              {backToSite.label}
            </a>
          ) : (
            <span />
          )}
          <LanguageGlobe variant="dark" />
        </div>

        <div className="relative flex justify-center px-4 pb-7 pt-1 sm:pb-9">
          <div className="inline-flex flex-col items-start">
            {/* The speech bubble of the model: a word said to whoever arrives,
                with its tail pointing at the mark. */}
            <span className="relative mb-3 -rotate-3 rounded-xl bg-brand-yellow px-3.5 py-1 font-display text-sm font-bold uppercase tracking-wide text-ink shadow-yellow sm:text-base">
              {t('welcome')}
              <span
                aria-hidden="true"
                className="absolute -bottom-1.5 left-5 size-3 rotate-45 rounded-[2px] bg-brand-yellow"
              />
            </span>
            <span className="flex items-center gap-3">
              <Image
                src="/brand/logo.png"
                alt="Only One Coin"
                width={768}
                height={127}
                priority
                className="h-9 w-auto sm:h-12"
              />
              {badge && (
                <span className="rounded-full bg-brand-yellow px-3 py-1 text-xs font-bold uppercase tracking-wide text-ink">
                  {badge}
                </span>
              )}
            </span>
          </div>
        </div>
      </header>

      <main className="flex flex-1 justify-center px-4 py-8 sm:px-6 sm:py-12">
        <div className={`w-full ${columnClass[door]}`}>{children}</div>
      </main>
    </div>
  )
}
