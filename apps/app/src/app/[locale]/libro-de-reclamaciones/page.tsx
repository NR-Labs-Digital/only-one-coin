import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { LEGAL_IDENTITY } from '@ooc/domain/legal-identity'
import { PublicFormShell } from '@/components/public-form-shell'
import { isFeatureEnabled } from '@/lib/feature-flags/server'
import { legacyComplaintsFormUrl } from '@/lib/org'
import type { Locale } from '@/lib/format'
import { env } from '@/env'
import { ComplaintForm } from './complaint-form'

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'complaints' })
  return { title: t('meta_title') }
}

/**
 * The complaints book (Libro de Reclamaciones, OOC-63): the public form the
 * landing's footer points at, on every page. Anybody files — a student or
 * not — with no session. The supplier is printed from `LEGAL_IDENTITY`, the
 * same identity the landing and the sheet itself carry.
 *
 * While the `complaints` flag is off in production (the inbox, OOC-58, is not
 * built yet), the address keeps working by sending people to the old form.
 */
export default async function ComplaintsBookPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  setRequestLocale(locale)
  if (!(await isFeatureEnabled('complaints'))) redirect(legacyComplaintsFormUrl)

  const t = await getTranslations('complaints')
  const site = (env.NEXT_PUBLIC_LANDING_URL ?? '').replace(/\/+$/, '')
  // The landing's own routing: es-PE has no prefix, /en and /pt do.
  const privacyUrl = `${site}${locale === 'es' ? '' : `/${locale}`}/privacy-policy`

  return (
    <PublicFormShell
      label={t('brand_label')}
      backToSite={t('back_to_site')}
      footerNote={t('footer_note')}
      support={t('support')}
    >
      <ComplaintForm
        locale={locale as Locale}
        siteKey={env.NEXT_PUBLIC_TURNSTILE_SITE_KEY}
        supplier={LEGAL_IDENTITY}
        privacyUrl={privacyUrl}
        siteUrl={site || '/'}
      />
    </PublicFormShell>
  )
}
