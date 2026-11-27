'use client'

import { useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { BoIcon } from '@/components/backoffice/icons'
import { formatDate, type Locale } from '@/lib/format'
import type { ClassroomCredentials } from '@/lib/backoffice/classroom-accounts-client'

/**
 * A Classroom login shown back (OOC-196): e-mail and password, each with a
 * copy button. Used by the accounts screen after a reveal and by the teacher's
 * "Ver mis accesos de Classroom". The password is in the DOM only while this
 * is open — it is fetched on the click, never with the page.
 */
export function ClassroomCredentialsCard({ credentials }: { credentials: ClassroomCredentials }) {
  const t = useTranslations('bo')
  const locale = useLocale() as Locale

  return (
    <div className="flex flex-col gap-3">
      <CopyRow label={t('classroom_accounts.field_email')} value={credentials.email} />
      <CopyRow label={t('classroom_accounts.field_password')} value={credentials.password} mono />
      <p className="text-xs text-muted-foreground">
        {t('classroom_accounts.password_changed', { date: formatDate(credentials.passwordChangedAt, locale) })}
      </p>
    </div>
  )
}

function CopyRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  const t = useTranslations('bo')
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // No clipboard (an old browser, a page without permission): the value is on screen to select.
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      <div className="flex items-center gap-2 rounded-lg border border-line bg-cream px-3 py-2">
        <span className={`min-w-0 flex-1 select-all break-all text-sm text-ink ${mono ? 'font-mono' : ''}`}>{value}</span>
        <button
          type="button"
          onClick={() => void copy()}
          className="inline-flex min-h-tap shrink-0 items-center gap-1 rounded-md px-2 text-xs font-semibold text-brand-blue transition hover:bg-white"
        >
          <BoIcon name={copied ? 'check' : 'copy'} size={14} />
          {t(copied ? 'classroom_accounts.copied' : 'classroom_accounts.copy')}
        </button>
      </div>
    </div>
  )
}
