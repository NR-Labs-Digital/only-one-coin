import type { ReactNode } from 'react'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { PublicFormShell } from '@/components/public-form-shell'
import { CheckoutAnalytics } from '@/components/enrollment/checkout-analytics'

/**
 * Shell for the public checkout.
 *
 * Its own shell, not the portal's: this is the one screen a stranger reaches,
 * with no session behind it, and a sidebar of links they cannot open would only
 * invite them to leave a form they are halfway through. The frame is shared
 * with the complaints book (`components/public-form-shell.tsx`).
 *
 * The draft lives in `sessionStorage` (`lib/enrollment/use-checkout.ts`), so
 * leaving to check a price on the site and coming back loses nothing.
 */
export default async function EnrollmentLayout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('enrollment')

  return (
    <PublicFormShell
      label={t('brand.label')}
      backToSite={t('brand.back_to_site')}
      footerNote={t('footer.secure')}
      support={t('footer.support')}
    >
      {children}
      {/* PostHog and the pixel banner (OOC-47) — this layout is the only
          place in apps/app that measures anything. */}
      <CheckoutAnalytics />
    </PublicFormShell>
  )
}
