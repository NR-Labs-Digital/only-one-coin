'use client'

import { useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { BoIcon } from '@/components/backoffice/icons'
import { issuePortalAccess, type IssuePortalAccessOutcome } from '@/lib/backoffice/portal-access-client'
import type { PortalAccessState } from '@/lib/backoffice/types'

/**
 * Shows where the student's portal access stands and, for whoever may, sends
 * it: creates the account, re-sends the activation, or sends a reset link —
 * the API picks which. The outcome is said back in words, never as its code.
 * The same button is how a pending guardian consent is asked for again
 * (OOC-72): it opens, or re-sends, the guardian's own access.
 */
export function PortalAccessControl({
  studentId,
  state,
  canIssue,
}: {
  studentId: string
  state: PortalAccessState
  canIssue: boolean
}) {
  const t = useTranslations('bo')
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ tone: 'ok' | 'warn'; text: string } | null>(null)

  async function send() {
    setBusy(true)
    setMessage(null)
    const result = await issuePortalAccess(studentId)
    setBusy(false)
    if (!result.ok) {
      setMessage({ tone: 'warn', text: t(`student_file.portal_access_error.${result.error}`) })
      return
    }
    const warn: IssuePortalAccessOutcome[] = ['email_conflict']
    // The guardian's door (OOC-72): opened with the student's account, or
    // while a minor's consent is pending — said after the student's part.
    const guardianText = result.guardian ? t(`student_file.portal_access_guardian_outcome.${result.guardian}`) : null
    setMessage({
      tone: warn.includes(result.outcome) || result.guardian === 'conflict' ? 'warn' : 'ok',
      text: [t(`student_file.portal_access_outcome.${result.outcome}`), guardianText].filter(Boolean).join(' '),
    })
    startTransition(() => router.refresh())
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-ink">
        <BoIcon name="email" size={14} />
        {t(`student_file.portal_access_state.${state}`)}
      </span>
      {canIssue && (
        <button
          type="button"
          onClick={() => void send()}
          disabled={busy || pending}
          className="inline-flex items-center gap-1.5 rounded-lg border border-brand-blue px-3 py-1.5 text-xs font-semibold text-brand-blue transition hover:bg-sky disabled:opacity-60"
        >
          {busy ? t('student_file.portal_access_sending') : t('student_file.portal_access_send')}
        </button>
      )}
      {message && (
        <p role="status" className={`w-full text-xs ${message.tone === 'ok' ? 'text-emerald-700' : 'text-amber-700'}`}>
          {message.text}
        </p>
      )}
    </div>
  )
}
