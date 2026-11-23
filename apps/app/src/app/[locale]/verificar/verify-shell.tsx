import type { ReactNode } from 'react'
import { getTranslations } from 'next-intl/server'
import { env } from '@/env'
import { AuthBannerLayout } from '@/components/auth/auth-banner-layout'

/**
 * The frame of the public validation page (OOC-59): the student door's band,
 * because whoever arrives here came from a paper the institution printed —
 * an employer, a school, the student — and should land on the brand they saw
 * on it, with the way back to the site.
 */
export async function VerifyShell({ children }: { children: ReactNode }) {
  const t = await getTranslations('login')
  return (
    <AuthBannerLayout door="student" backToSite={{ href: env.NEXT_PUBLIC_LANDING_URL ?? '/', label: t('back_to_site') }}>
      {children}
    </AuthBannerLayout>
  )
}
