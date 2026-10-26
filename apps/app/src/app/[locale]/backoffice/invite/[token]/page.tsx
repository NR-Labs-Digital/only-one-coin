import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { AuthBannerLayout } from '@/components/auth/auth-banner-layout'
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
    <AuthBannerLayout door="staff">
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
    </AuthBannerLayout>
  )
}
