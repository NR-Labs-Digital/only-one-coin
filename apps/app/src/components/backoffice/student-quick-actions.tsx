'use client'

import type { MouseEvent } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { whatsappChatUrl } from '@/lib/backoffice/whatsapp-link'
import { BoIcon } from '@/components/backoffice/icons'
import { WhatsAppMark } from '@/components/enrollment/whatsapp-mark'
import { rowActionClass } from '@/components/backoffice/ui'

/**
 * The two shortcuts the receipt review needs about the person behind a payment
 * (OOC-146): write to them on WhatsApp — a receipt that cannot be read is
 * fixed by asking for a better photo — and open their file.
 *
 * Each one shows only when it can work: the number reaches this screen only for
 * the roles the API sends it to (`PAYMENT_CONTACT_ROLES`), and the file link
 * only for who may open the file (`canBrowseStudents`, passed in as
 * `canOpenFile`). Hiding is convenience; the API's roles are what enforce.
 *
 * Clicks stop here: the queue's row opens the case on click, and a shortcut
 * inside it must not open the case too.
 */
export function StudentQuickActions({
  studentId,
  studentName,
  phone,
  canOpenFile,
  compact = false,
}: {
  studentId: string
  studentName: string
  phone: string | null
  canOpenFile: boolean
  /** Icon-only, for the queue's row; the dialog shows the labels. */
  compact?: boolean
}) {
  const t = useTranslations('bo')
  const chat = whatsappChatUrl(phone)
  if (!chat && !canOpenFile) return null

  const stop = (event: MouseEvent) => event.stopPropagation()
  const whatsappLabel = t('student_actions.whatsapp', { name: studentName })
  const fileLabel = t('student_actions.file', { name: studentName })

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {chat && (
        <a
          href={chat}
          target="_blank"
          rel="noopener noreferrer"
          onClick={stop}
          aria-label={compact ? whatsappLabel : undefined}
          title={compact ? whatsappLabel : undefined}
          className={`${rowActionClass} min-h-tap`}
        >
          <WhatsAppMark size={16} />
          {!compact && t('student_actions.whatsapp_short')}
        </a>
      )}
      {canOpenFile && (
        <Link
          href={`/backoffice/students/${studentId}`}
          onClick={stop}
          aria-label={compact ? fileLabel : undefined}
          title={compact ? fileLabel : undefined}
          className={`${rowActionClass} min-h-tap`}
        >
          <BoIcon name="students" size={16} />
          {!compact && t('student_actions.file_short')}
        </Link>
      )}
    </span>
  )
}
