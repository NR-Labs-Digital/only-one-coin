'use client'

import { useLocale, useTranslations } from 'next-intl'
import type { TeacherContract } from '@/lib/backoffice/types'
import { contractAlert } from '@/lib/backoffice/contract'
import { formatDate, type Locale } from '@/lib/format'
import { StatusBadge, type Tone } from './ui'

const tone: Record<ReturnType<typeof contractAlert>, Tone> = {
  missing: 'danger',
  expired: 'danger',
  expiring: 'warning',
  valid: 'success',
}

/**
 * Where a teacher's contract stands, in one line. The three states that need
 * doing something about — none on file, lapsed, lapsing — are the loud ones;
 * a contract in force just says until when, because that is the question
 * somebody opens the roster with.
 *
 * `daysLeft` arrives computed from the server clock (`listTeachers`): a date
 * subtracted in the browser hydrates a different number than it rendered.
 */
export function ContractBadge({
  contract,
  daysLeft,
  alertDays,
}: {
  contract: TeacherContract | null
  daysLeft: number | null
  /** The backoffice's alert window, as the API answered it (OOC-41). */
  alertDays: number
}) {
  const t = useTranslations('bo')
  const locale = useLocale() as Locale
  const alert = contractAlert(daysLeft, alertDays)

  if (alert === 'missing' || contract === null) {
    return <StatusBadge tone="danger" label={t('teachers.contract_missing')} />
  }

  const days = daysLeft ?? 0
  const label =
    alert === 'expired'
      ? t('teachers.contract_expired', { days: -days })
      : alert === 'expiring'
        ? t('teachers.contract_expiring', { days })
        : t('teachers.contract_valid', { date: formatDate(contract.endsAt, locale) })

  return (
    <StatusBadge
      tone={tone[alert]}
      dot={alert !== 'valid'}
      label={label}
      title={t('teachers.contract_alert_hint', { days: alertDays })}
    />
  )
}
