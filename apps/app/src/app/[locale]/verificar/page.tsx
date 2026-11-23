import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { normalizeDocumentCode } from '@ooc/domain/issued-document'
import { getPathname, redirect } from '@/i18n/navigation'
import { VerifyShell } from './verify-shell'
import { VerifyForm } from './verify-form'

// A validation page answers one person at a time; it has nothing to index.
export const metadata: Metadata = { robots: { index: false, follow: false } }

/**
 * `/verificar` (OOC-59): where a code typed off the paper is checked. A code
 * that can be one goes to its own page; one that cannot gets the same answer
 * as a code nobody issued.
 */
export default async function VerifyPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ code?: string | string[] }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('verify')
  const raw = (await searchParams).code
  const typed = typeof raw === 'string' ? raw : undefined
  const code = typed ? normalizeDocumentCode(typed) : null
  if (code) redirect({ href: `/verificar/${code}`, locale })

  return (
    <VerifyShell>
      <div className="rounded-[28px] border border-line bg-white p-6 shadow-float sm:p-7">
        <h1 className="font-display text-3xl font-semibold text-ink">{t('title')}</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{t('subtitle')}</p>
        {typed !== undefined && (
          <p role="alert" className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {t('not_found')}
          </p>
        )}
        <div className="mt-5">
          <VerifyForm action={getPathname({ href: '/verificar', locale })} defaultValue={typed} />
        </div>
      </div>
    </VerifyShell>
  )
}
