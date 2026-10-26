import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { AuthBannerLayout } from '@/components/auth/auth-banner-layout'
import { ShieldIcon } from '@/components/backoffice/auth-icons'
import { StaffLoginForm, type InitialLoginStep } from '@/components/backoffice/staff-login-form'

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

  return (
    <AuthBannerLayout door="staff">
      <StaffLoginForm initialStep={initialStep} />

      <p className="mt-8 flex items-start gap-2 text-xs text-muted-foreground">
        <ShieldIcon size={14} className="mt-0.5 shrink-0 text-brand-blue" />
        {t('security_notice')}
      </p>
    </AuthBannerLayout>
  )
}
