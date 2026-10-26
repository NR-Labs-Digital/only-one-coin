import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { AuthBannerLayout } from '@/components/auth/auth-banner-layout'
import { apiFetch } from '@/lib/backoffice/api-client'
import { isInviteExpired } from '@/lib/backoffice/invite'
import { requireFeature } from '@/lib/feature-flags/server'
import { CheckCircleIcon, ShieldIcon } from '@/components/backoffice/auth-icons'
import { PasswordResetForm } from './password-reset-form'

/**
 * Where a password-reset link lands — same shape as the invite completion
 * screen (`/backoffice/invite/[token]/page.tsx`) and for the same reasons:
 * outside `(panel)` because the person here has no session (that is why
 * they're here), never linked from anywhere in the app, gated on
 * `backoffice.staff` since it's the same screen that generates the link.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
}

export default async function PasswordResetPage({
  params,
}: {
  params: Promise<{ locale: string; token: string }>
}) {
  const { locale, token } = await params
  setRequestLocale(locale)

  await requireFeature('backoffice.staff')

  const t = await getTranslations('backoffice')

  const response = await apiFetch(`/api/v1/staff/password-resets/${token}`)
  const reset = response.ok
    ? ((await response.json()) as {
        name: string
        email: string
        status: 'pending' | 'completed' | 'cancelled'
        expiresAt: string
      })
    : null

  const state =
    !reset || reset.status !== 'pending'
      ? 'invalid'
      : isInviteExpired(reset.expiresAt)
        ? 'expired'
        : 'valid'

  return (
    <AuthBannerLayout door="staff">
      {state === 'valid' && reset ? (
        <PasswordResetForm token={token} name={reset.name} email={reset.email} />
      ) : (
        <div className="rounded-3xl border border-line bg-white p-7 shadow-float sm:p-8">
          <div className="mb-5 grid h-12 w-12 place-items-center rounded-2xl bg-amber-50 text-amber-600">
            <ShieldIcon size={24} />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">
            {t(state === 'expired' ? 'reset_expired_title' : 'reset_invalid_title')}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t(state === 'expired' ? 'reset_expired_body' : 'reset_invalid_body')}
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
          {t('reset_security_notice')}
        </p>
      )}
    </AuthBannerLayout>
  )
}
