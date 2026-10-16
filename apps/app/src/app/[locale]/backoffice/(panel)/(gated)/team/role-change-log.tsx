'use client'

import { useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import type { StaffRoleChange } from '@/lib/backoffice/types'
import { formatDateTime, type Locale } from '@/lib/format'
import {
  Card,
  EmptyState,
  Pager,
  SectionTitle,
  TableShell,
  tdClass,
  thClass,
} from '@/components/backoffice/ui'
import { BoIcon } from '@/components/backoffice/icons'

const PAGE_SIZE = 10

const roleBadgeClass =
  'rounded-full bg-sky px-2 py-0.5 text-[11px] font-semibold text-brand-blue-deep'

/**
 * The cargo ledger: every `role` ever decided for a panel account, newest
 * first — promotions and the cargo an invite was opened with. Read straight
 * from `audit_log` (`GET /api/v1/staff/role-changes`), so it shows what the
 * server wrote, never what this screen did locally; the directory refreshes
 * the page after each write to pull the new entry in.
 */
export function RoleChangeLog({ items }: { items: StaffRoleChange[] }) {
  const t = useTranslations('bo')
  const locale = useLocale() as Locale
  const [page, setPage] = useState(0)

  const pageCount = Math.max(1, Math.ceil(items.length / PAGE_SIZE))
  const currentPage = Math.min(page, pageCount - 1)
  const pageRows = items.slice(currentPage * PAGE_SIZE, currentPage * PAGE_SIZE + PAGE_SIZE)

  return (
    <section className="flex flex-col gap-3">
      <SectionTitle icon="clock">{t('team.log_title')}</SectionTitle>
      <Card>
        {items.length === 0 ? (
          <div className="p-4">
            <EmptyState
              icon="clock"
              title={t('team.log_empty_title')}
              body={t('team.log_empty_body')}
            />
          </div>
        ) : (
          <>
            <TableShell
              columns={[
                t('team.log_col_date'),
                t('team.log_col_member'),
                t('team.log_col_change'),
                t('team.log_col_actor'),
              ]}
            >
              <thead>
                <tr>
                  <th className={thClass}>{t('team.log_col_date')}</th>
                  <th className={thClass}>{t('team.log_col_member')}</th>
                  <th className={thClass}>{t('team.log_col_change')}</th>
                  <th className={thClass}>{t('team.log_col_actor')}</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((row) => (
                  <tr key={row.id}>
                    <td className={`${tdClass} whitespace-nowrap text-xs text-muted-foreground`}>
                      {formatDateTime(row.at, locale)}
                    </td>
                    <td className={`${tdClass} whitespace-nowrap font-semibold`}>
                      {row.memberName}
                    </td>
                    <td className={`${tdClass} whitespace-nowrap`}>
                      {/* No "from" means the cargo was born with the invite,
                          not moved — said in words, not as an empty badge. */}
                      <span className="inline-flex items-center gap-1.5">
                        {row.fromRole ? (
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                            {t(`role.${row.fromRole}`)}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            {t('team.log_invited')}
                          </span>
                        )}
                        <BoIcon name="chevron-right" size={12} className="text-muted-foreground" />
                        <span className={roleBadgeClass}>{t(`role.${row.toRole}`)}</span>
                      </span>
                    </td>
                    <td className={`${tdClass} whitespace-nowrap`}>
                      <span className="flex flex-col leading-tight">
                        <span>{row.actorName}</span>
                        <span className="text-xs text-muted-foreground">
                          {t(`role.${row.actorRole}`)}
                        </span>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </TableShell>

            {pageCount > 1 && (
              <Pager
                page={currentPage}
                pageCount={pageCount}
                status={t('team.page_status', {
                  from: currentPage * PAGE_SIZE + 1,
                  to: currentPage * PAGE_SIZE + pageRows.length,
                  total: items.length,
                })}
                prevLabel={t('team.page_prev')}
                nextLabel={t('team.page_next')}
                onChange={setPage}
              />
            )}
          </>
        )}
      </Card>
    </section>
  )
}
