'use client'

import { useState, useTransition } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Link, useRouter } from '@/i18n/navigation'
import type { EmailDeliveryIssue } from '@/lib/backoffice/types'
import { resendEmailDelivery } from '@/lib/backoffice/email-delivery-client'
import { formatDateTime, formatNumber, type Locale } from '@/lib/format'
import {
  Card,
  EmptyState,
  StatusBadge,
  TableShell,
  tdClass,
  thClass,
  rowActionClass,
} from '@/components/backoffice/ui'
import { Toast } from '@/components/backoffice/controls'
import { BoIcon } from '@/components/backoffice/icons'

/**
 * One row per person the institution failed to reach.
 *
 * The row's action is decided by the e-mail, not offered as a menu. An
 * enrollment or payment e-mail gets the resend — an audited exception, never
 * a routine (`docs/DOCUMENTOS-E-CERTIFICADOS.md` §4) — and it goes to the
 * address on the file today, so fixing a typo first and then resending is the
 * whole repair. A portal-access e-mail gets the file instead: its one-time
 * link is gone, and "Send portal access" there issues a fresh one.
 */
export function DeliveriesView({
  rows,
  total,
  canResend,
}: {
  rows: EmailDeliveryIssue[]
  total: number
  canResend: boolean
}) {
  const t = useTranslations('bo')
  const locale = useLocale() as Locale
  const router = useRouter()
  const [refreshing, startTransition] = useTransition()
  const [sending, setSending] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  async function resend(row: EmailDeliveryIssue) {
    setSending(row.id)
    const result = await resendEmailDelivery(row.id)
    setSending(null)
    setToast(result.ok ? t('deliveries.resend_toast') : t(`deliveries.resend_error.${result.error}`))
    // Resent or already resent, the row is no longer an errand.
    if (result.ok || result.error === 'already_resent') startTransition(() => router.refresh())
  }

  if (rows.length === 0) {
    return (
      <Card>
        <div className="p-4">
          <EmptyState
            icon="check"
            title={t('deliveries.empty_title')}
            body={t('deliveries.empty_body')}
          />
        </div>
      </Card>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {total > rows.length && (
        <p className="text-xs text-muted-foreground">
          {t('deliveries.truncated', {
            shown: formatNumber(rows.length, locale),
            total: formatNumber(total, locale),
          })}
        </p>
      )}
      <Card>
        <TableShell
          columns={[
            t('deliveries.col_student'),
            t('deliveries.col_email'),
            t('deliveries.col_reason'),
            t('deliveries.col_when'),
            '',
          ]}
        >
          <thead>
            <tr>
              <th className={thClass}>{t('deliveries.col_student')}</th>
              <th className={thClass}>{t('deliveries.col_email')}</th>
              <th className={thClass}>{t('deliveries.col_reason')}</th>
              <th className={thClass}>{t('deliveries.col_when')}</th>
              <th className={thClass}>
                <span className="sr-only">{t('common.actions')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const file = row.studentId ? `/backoffice/students/${row.studentId}` : null
              const name = row.studentName ?? t('deliveries.no_file')
              return (
                <tr key={row.id} className="transition hover:bg-sky-soft">
                  <td className={tdClass}>
                    <span className="flex min-w-0 flex-col">
                      {/* Straight to the file: that is where the phone number
                          is, and calling is what actually fixes this. */}
                      {file ? (
                        <Link
                          href={file}
                          className="font-semibold text-ink transition hover:text-brand-blue"
                        >
                          {name}
                        </Link>
                      ) : (
                        <span className="font-semibold text-muted-foreground">{name}</span>
                      )}
                      <span className="truncate text-xs text-muted-foreground">
                        {row.recipientKind === 'guardian'
                          ? t('deliveries.guardian_copy', { address: row.address })
                          : row.address}
                      </span>
                    </span>
                  </td>
                  <td className={`${tdClass} whitespace-nowrap text-sm text-muted-foreground`}>
                    {t(`email_template.${row.template}`)}
                  </td>
                  <td className={tdClass}>
                    <span className="flex flex-wrap items-center gap-2">
                      <StatusBadge tone="danger" label={t('email_delivery_state.failed')} />
                      <span className="text-xs text-muted-foreground">
                        {t(`email_delivery_reason.${row.reason}`)}
                      </span>
                    </span>
                  </td>
                  <td className={`${tdClass} whitespace-nowrap`}>
                    <span className="flex flex-col leading-tight">
                      <span className="text-sm text-ink">
                        {formatDateTime(row.at, locale)}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {t('deliveries.attempts', { count: row.attempts })}
                      </span>
                    </span>
                  </td>
                  <td className={`${tdClass} text-right`}>
                    {canResend && row.resendable ? (
                      <button
                        type="button"
                        onClick={() => void resend(row)}
                        disabled={sending !== null || refreshing}
                        className={`${rowActionClass} disabled:opacity-60`}
                      >
                        {sending === row.id
                          ? t('deliveries.resending')
                          : t('deliveries.action_resend')}
                      </button>
                    ) : (
                      file && (
                        <Link href={file} className={rowActionClass}>
                          {t('deliveries.action_open')}
                        </Link>
                      )
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </TableShell>
      </Card>

      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <BoIcon name="shield" size={14} className="mt-0.5 shrink-0" />
        {t('deliveries.resend_note')}
      </p>

      <Toast message={toast} onDismiss={() => setToast(null)} />
    </div>
  )
}
