import type { Metadata } from 'next'
import Image from 'next/image'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { LanguageGlobe } from '@/components/language-globe'
import { apiFetch } from '@/lib/backoffice/api-client'
import { isInviteExpired } from '@/lib/backoffice/invite'
import { requireFeature } from '@/lib/feature-flags/server'
import type { StaffRole } from '@/lib/backoffice/types'
import { CheckCircleIcon, ShieldIcon } from '@/components/backoffice/auth-icons'
import { InviteCompletionForm } from './invite-completion-form'

/**
 * Where an invite link lands — never linked from anywhere in the app itself,
 * only ever reached from the one-time URL a `admin` copied out of Equipo and
 * sent by hand (`CLAUDE.md` §8, §1). Discreet and unindexable like the rest of
 * the backoffice, and gated on the same flag as the screen that generates the
 * link: with `backoffice.staff` off, there is no invite to complete either.
 *
 * Outside `(panel)` on purpose — a session-gated layout cannot render for
 * somebody who has no session yet, the same reason `/backoffice` itself
 * (the login screen) sits here instead of under the panel shell.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
}

export default async function InviteCompletionPage({
  params,
}: {
  params: Promise<{ locale: string; token: string }>
}) {
  const { locale, token } = await params
  setRequestLocale(locale)

  await requireFeature('backoffice.staff')

  const t = await getTranslations('backoffice')
  const tRole = await getTranslations('bo')

  const response = await apiFetch(`/api/v1/staff/invites/${token}`)
  const invite = response.ok
    ? ((await response.json()) as {
        firstName: string
        email: string
        role: StaffRole
        status: 'pending' | 'completed' | 'cancelled'
        expiresAt: string
      })
    : null

  const state =
    !invite || invite.status !== 'pending'
      ? 'invalid'
      : isInviteExpired(invite.expiresAt)
        ? 'expired'
        : 'valid'

  return (
    <div className="grid min-h-dvh bg-sky-soft lg:grid-cols-[1.05fr_0.95fr]">
      {/* Brand panel — same as the login screen: an invitee meets the same
          brand a staff member signing in does. */}
      <aside className="relative hidden overflow-hidden bg-ink px-12 py-14 lg:flex lg:flex-col">
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
            backgroundImage: 'radial-gradient(#ffffff 2.2px, transparent 2.2px)',
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

        <div className="relative my-auto max-w-md">
          <h2 className="text-4xl font-semibold leading-tight text-white">
            {t('brand_title')}
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-slate-300">{t('brand_body')}</p>
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
            {state === 'valid' && invite ? (
              <InviteCompletionForm
                token={token}
                firstName={invite.firstName}
                email={invite.email}
                roleLabel={tRole(`role.${invite.role}`)}
              />
            ) : (
              <div className="rounded-3xl border border-line bg-white p-7 shadow-float sm:p-8">
                <div className="mb-5 grid h-12 w-12 place-items-center rounded-2xl bg-amber-50 text-amber-600">
                  <ShieldIcon size={24} />
                </div>
                <h1 className="text-2xl font-semibold tracking-tight text-ink">
                  {t(state === 'expired' ? 'invite_expired_title' : 'invite_invalid_title')}
                </h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t(state === 'expired' ? 'invite_expired_body' : 'invite_invalid_body')}
                </p>
                <Link
                  href="/backoffice"
                  className="mt-6 flex w-full items-center justify-center gap-2 rounded-full bg-brand-blue px-4 py-3 text-sm font-bold text-white shadow-[0_16px_30px_-14px_rgba(47,107,255,0.9)] transition hover:bg-brand-yellow hover:text-ink"
                >
                  {t('invite_back_to_login')}
                </Link>
              </div>
            )}

            {state === 'valid' && (
              <p className="mt-8 flex items-start gap-2 text-xs text-muted-foreground">
                <CheckCircleIcon size={14} className="mt-0.5 shrink-0 text-brand-blue" />
                {t('invite_security_notice')}
              </p>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}
