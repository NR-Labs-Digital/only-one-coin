import type { Metadata } from 'next'
import Image from 'next/image'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { LanguageGlobe } from '@/components/language-globe'
import { CheckCircleIcon, KeyIcon, ShieldIcon } from './icons'
import { BackofficeLoginForm, type InitialLoginStep } from './backoffice-login-form'

/**
 * Backoffice entry point — deliberately discreet: never linked from the landing
 * and never indexable (CLAUDE.md §8). This is defense in depth, not the defense:
 * real access control is the role check in `apps/api`, wired later.
 *
 * Visual language mirrors the landing (blue + white + yellow on navy, Fredoka
 * display + Poppins body) so staff sees the same brand the students see.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
}

/**
 * `?mfa=` opens the form on a second-factor step: `challenge` after a password
 * reset on an account with the factor on (Better Auth is holding the session
 * for a code), `setup` when the panel was refused for a cargo that must turn
 * it on (lib/backoffice/session.ts). Anything else is the plain login.
 */
const INITIAL_STEPS: Record<string, InitialLoginStep> = {
  challenge: 'mfa',
  setup: 'mfa_setup',
}

export default async function BackofficePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ mfa?: string | string[] }>
}) {
  const { locale } = await params
  const { mfa } = await searchParams
  const initialStep = typeof mfa === 'string' ? INITIAL_STEPS[mfa] : undefined
  setRequestLocale(locale)
  const t = await getTranslations('backoffice')

  const highlights = [
    { icon: ShieldIcon, title: t('highlight_1_title') },
    { icon: KeyIcon, title: t('highlight_2_title') },
    { icon: CheckCircleIcon, title: t('highlight_3_title') },
  ]

  return (
    <div
      className="grid min-h-dvh bg-sky-soft lg:grid-cols-[1.05fr_0.95fr]"
    >
      {/* Brand panel — desktop only; the phone gets the compact header below. */}
      <aside className="relative hidden overflow-hidden bg-ink px-12 py-14 lg:flex lg:flex-col">
        {/* Decorations borrowed from the landing hero: soft blobs + dot grid. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -right-28 -top-32 h-96 w-96 rounded-full bg-brand-yellow/20 blur-3xl"
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-36 -left-28 h-96 w-96 rounded-full bg-brand-blue/30 blur-3xl"
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-[0.16]"
          style={{
            backgroundImage:
              'radial-gradient(#ffffff 2.2px, transparent 2.2px)',
            backgroundSize: '22px 22px',
          }}
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'radial-gradient(70% 60% at 85% 8%, rgba(255,201,60,0.18), transparent 60%), radial-gradient(60% 55% at 5% 95%, rgba(47,107,255,0.35), transparent 60%)',
          }}
        />

        <div className="relative">
          <Image
            src="/brand/logo.png"
            alt="Only One Coin"
            width={768}
            height={127}
            priority
            className="h-9 w-auto"
          />
        </div>

        {/* `my-auto` centers the block in what the logo left over — the panel
            lost its footer, so justify-between would pin this to the bottom. */}
        <div className="relative my-auto max-w-md">
          <h2 className="text-4xl font-semibold leading-tight text-white">
            {t('brand_title')}
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-slate-300">
            {t('brand_body')}
          </p>

          <ul className="mt-8 flex flex-col gap-4">
            {highlights.map(({ icon: Icon, title }) => (
              <li key={title} className="flex items-center gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white/10 text-brand-yellow">
                  <Icon size={18} />
                </span>
                <span className="text-sm font-semibold text-white">{title}</span>
              </li>
            ))}
          </ul>
        </div>
      </aside>

      {/* Form side */}
      <main className="flex flex-col px-6 py-8 sm:px-10 lg:px-14 lg:py-12">
        <div className="mb-10 flex items-center justify-between gap-4">
          <Image
            src="/brand/logo.png"
            alt="Only One Coin"
            width={768}
            height={127}
            className="h-7 w-auto lg:hidden"
          />
          <span className="hidden lg:inline" />
          <LanguageGlobe />
        </div>

        <div className="flex flex-1 items-center justify-center">
          <div className="w-full max-w-sm">
            <BackofficeLoginForm initialStep={initialStep} />

            <p className="mt-8 flex items-start gap-2 text-xs text-muted-foreground">
              <ShieldIcon size={14} className="mt-0.5 shrink-0 text-brand-blue" />
              {t('security_notice')}
            </p>
          </div>
        </div>
      </main>
    </div>
  )
}
