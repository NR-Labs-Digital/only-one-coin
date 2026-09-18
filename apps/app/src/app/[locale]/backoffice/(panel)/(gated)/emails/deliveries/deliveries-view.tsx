'use client'

import { useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import type { EmailDeliveryIssue } from '@/lib/backoffice/types'
import { deliveryAction } from '@/lib/backoffice/email-delivery'
import { formatDateTime, type Locale } from '@/lib/format'
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
 * The row's action is decided by the reason, not offered as a menu: a
 * misspelled domain does not get a resend button, because resending it bounces
 * again — it gets the file, where the address is fixed. A full mailbox or a
 * provider error gets the resend, which is an audited exception and never a
 * routine (`docs/DOCUMENTOS-E-CERTIFICADOS.md` §4).
 */
export function DeliveriesView({ rows }: { rows: EmailDeliveryIssue[] }) {
  const t = useTranslations('bo')
  const locale = useLocale() as Locale
  const [toast, setToast] = useState<string | null>(null)

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
              const action = deliveryAction(row.reason)
              return (
                <tr key={row.id} className="transition hover:bg-sky-soft">
                  <td className={tdClass}>
                    <span className="flex min-w-0 flex-col">
                      {/* Straight to the file: that is where the phone number
                          is, and calling is what actually fixes this. */}
                      <Link
                        href={`/backoffice/students/${row.studentId}`}
                        className="font-semibold text-ink transition hover:text-brand-blue"
                      >
                        {row.studentName}
                      </Link>
                      <span className="truncate text-xs text-muted-foreground">
                        {row.address}
                      </span>
                    </span>
                  </td>
                  <td className={`${tdClass} whitespace-nowrap text-sm text-muted-foreground`}>
                    {t(`email_template.${row.template}`)}
                  </td>
                  <td className={tdClass}>
                    <span className="flex flex-wrap items-center gap-2">
                      <StatusBadge
                        tone={row.state === 'bounced' ? 'warning' : 'danger'}
                        label={t(`email_delivery_state.${row.state}`)}
                      />
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
                    {action === 'resend' ? (
                      <button
                        type="button"
                        onClick={() => setToast(t('deliveries.resend_toast'))}
                        className={rowActionClass}
                      >
                        {t('deliveries.action_resend')}
                      </button>
                    ) : (
                      <Link
                        href={`/backoffice/students/${row.studentId}`}
                        className={rowActionClass}
                      >
                        {t('deliveries.action_fix')}
                      </Link>
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
