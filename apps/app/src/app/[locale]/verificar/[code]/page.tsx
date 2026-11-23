import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { normalizeDocumentCode } from '@ooc/domain/issued-document'
import { getPathname, redirect } from '@/i18n/navigation'
import { formatDate, type Locale } from '@/lib/format'
import { verifyDocumentCode, type VerifiedDocument } from '@/lib/verify/server'
import { VerifyShell } from '../verify-shell'
import { VerifyForm } from '../verify-form'

export const metadata: Metadata = { robots: { index: false, follow: false } }

const STATUS_STYLE: Record<VerifiedDocument['status'], string> = {
  valid: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  revoked: 'border-red-200 bg-red-50 text-red-900',
  replaced: 'border-amber-200 bg-amber-50 text-amber-900',
}

/**
 * `/verificar/<code>` (OOC-59): where the QR on a document lands. Says whether
 * the code belongs to a document the institution issued, its status, and the
 * public fields — name, course, dates, issue date. Nothing else is asked of
 * the API, and nothing else comes back. A code nobody issued gets one generic
 * answer.
 */
export default async function VerifyCodePage({ params }: { params: Promise<{ locale: string; code: string }> }) {
  const { locale, code: rawCode } = await params
  setRequestLocale(locale)
  const t = await getTranslations('verify')
  const appLocale = locale as Locale
  const typed = decodeURIComponent(rawCode)
  const code = normalizeDocumentCode(typed)
  // Typed in another shape (lowercase, no dashes): the canonical address.
  if (code && code !== typed) redirect({ href: `/verificar/${code}`, locale })
  const outcome = code ? await verifyDocumentCode(code) : ({ kind: 'not_found' } as const)
  const formAction = getPathname({ href: '/verificar', locale })

  return (
    <VerifyShell>
      <div className="flex flex-col gap-5">
        {outcome.kind === 'found' ? (
          <section className="rounded-[28px] border border-line bg-white p-6 shadow-float sm:p-7">
            <p className="font-mono text-xs tracking-wider text-muted-foreground">{code}</p>
            <h1 className="mt-1 font-display text-2xl font-semibold text-ink">{t(`kind.${outcome.document.kind}`)}</h1>
            <p role="status" className={`mt-4 rounded-xl border px-3.5 py-3 text-sm font-semibold ${STATUS_STYLE[outcome.document.status]}`}>
              {t(`status.${outcome.document.status}`)}
              {outcome.document.revokedAt && outcome.document.status === 'revoked' && (
                <span className="mt-0.5 block text-xs font-normal">
                  {t('revoked_on', { date: formatDate(outcome.document.revokedAt, appLocale) })}
                </span>
              )}
            </p>
            <dl className="mt-5 grid gap-3 text-sm">
              <Field label={t('field.student')} value={outcome.document.studentName} />
              <Field label={t('field.course')} value={outcome.document.courseName} />
              {outcome.document.startsOn && outcome.document.endsOn && (
                <Field
                  label={t('field.period')}
                  value={t('period_value', {
                    from: formatDate(outcome.document.startsOn, appLocale),
                    to: formatDate(outcome.document.endsOn, appLocale),
                  })}
                />
              )}
              <Field label={t('field.issued_at')} value={formatDate(outcome.document.issuedAt, appLocale)} />
            </dl>
          </section>
        ) : (
          <section className="rounded-[28px] border border-line bg-white p-6 shadow-float sm:p-7">
            <h1 className="font-display text-2xl font-semibold text-ink">{t('title')}</h1>
            <p role="alert" className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              {t(outcome.kind === 'not_found' ? 'not_found' : outcome.kind === 'too_many' ? 'too_many' : 'error')}
            </p>
            <div className="mt-5">
              <VerifyForm action={formAction} defaultValue={code ?? typed} />
            </div>
          </section>
        )}
        {outcome.kind === 'found' && (
          <a href={formAction} className="text-center text-sm font-semibold text-brand-blue hover:underline">
            {t('check_another')}
          </a>
        )}
      </div>
    </VerifyShell>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="text-ink">{value}</dd>
    </div>
  )
}
