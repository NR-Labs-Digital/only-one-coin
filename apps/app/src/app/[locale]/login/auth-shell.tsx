import type { ReactNode } from 'react'
import { getTranslations } from 'next-intl/server'
import { env } from '@/env'
import { AuthBannerLayout } from '@/components/auth/auth-banner-layout'

/**
 * The visual frame of the student's public auth screens: login, forgot
 * password, set password. Dressed as the landing (see the login page's
 * comment): the screen where a password is typed is the worst place to look
 * like another product.
 */
export async function AuthShell({ children }: { children: ReactNode }) {
  const t = await getTranslations('login')
  const siteUrl = env.NEXT_PUBLIC_LANDING_URL ?? '/'

  return (
    <AuthBannerLayout
      door="student"
      backToSite={{ href: siteUrl, label: t('back_to_site') }}
    >
      {children}
    </AuthBannerLayout>
  )
}
