'use client'

import { useEffect, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import {
  answerAdConsent,
  hasPixels,
  startCheckoutAnalytics,
} from '@/lib/analytics/checkout-analytics'
import { env } from '@/env'

/**
 * The checkout's measurement (OOC-47): starts PostHog on mount and shows the
 * pixel banner while the visitor has not answered — the same answer the
 * landing asks for, shared through a parent-domain cookie, so somebody who
 * already answered there is not asked again. No pixel configured, no banner.
 *
 * A footer button reopens it, so a yes can be taken back (`withdraw`).
 */
export function CheckoutAnalytics() {
  const t = useTranslations('enrollment.consent')
  const locale = useLocale()
  const [open, setOpen] = useState(false)
  const [answered, setAnswered] = useState(true)

  useEffect(() => {
    const consent = startCheckoutAnalytics()
    // Reading a cookie is only possible after hydration; the banner appears
    // a frame late rather than being drawn on the server for everybody.
    if (hasPixels && consent === null) setOpen(true)
    setAnswered(consent !== null)
  }, [])

  if (!hasPixels) return null

  const site = (env.NEXT_PUBLIC_LANDING_URL ?? '').replace(/\/+$/, '')
  const policyHref = `${site}${locale === 'es' ? '' : `/${locale}`}/privacy-policy`

  function answer(value: 'granted' | 'denied') {
    answerAdConsent(value)
    setAnswered(true)
    setOpen(false)
  }

  if (!open) {
    return answered ? (
      <div className="mx-auto w-full max-w-3xl px-4 pb-4 sm:px-6">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-xs font-semibold text-muted-foreground underline-offset-2 hover:text-ink hover:underline"
        >
          {t('manage')}
        </button>
      </div>
    ) : null
  }

  return (
    <section
      aria-label={t('label')}
      className="fixed inset-x-3 bottom-3 z-50 flex flex-col gap-3 rounded-2xl border border-line bg-white p-4 text-sm text-ink shadow-lg sm:inset-x-auto sm:left-6 sm:bottom-6 sm:max-w-md"
    >
      <p>
        {t('text')}{' '}
        <a
          href={policyHref}
          target="_blank"
          rel="noopener"
          className="font-semibold text-brand-blue underline-offset-2 hover:underline"
        >
          {t('policy')}
        </a>
      </p>
      {/* Same size side by side: saying no must be as easy as saying yes. */}
      <div className="flex gap-2 sm:justify-end">
        <button
          type="button"
          onClick={() => answer('denied')}
          className="flex-1 rounded-full border-2 border-brand-blue px-5 py-2 font-bold text-brand-blue transition hover:bg-brand-blue hover:text-white sm:flex-none"
        >
          {t('reject')}
        </button>
        <button
          type="button"
          onClick={() => answer('granted')}
          className="flex-1 rounded-full bg-brand-blue px-5 py-2 font-bold text-white transition hover:bg-brand-yellow hover:text-ink sm:flex-none"
        >
          {t('accept')}
        </button>
      </div>
    </section>
  )
}
