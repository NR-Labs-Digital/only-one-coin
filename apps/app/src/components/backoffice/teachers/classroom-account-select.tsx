'use client'

import { useTranslations } from 'next-intl'
import type { ClassroomAccountList } from '@/lib/backoffice/types'

/**
 * The shared Classroom account a teacher uses (OOC-196), picked from the
 * accounts list. Each option says how many teachers already use it out of the
 * cap; a full one is disabled — unless it is the one the file already holds,
 * which never counts against itself. The API holds the cap again under a
 * lock: this only saves a round trip.
 */
export function ClassroomAccountSelect({
  id,
  accounts,
  value,
  onChange,
  teacherId,
  className,
}: {
  id?: string
  accounts: ClassroomAccountList
  value: string | null
  onChange: (next: string | null) => void
  /** The file being edited — its own place on an account is not "taken". */
  teacherId?: string
  className: string
}) {
  const t = useTranslations('bo')

  return (
    <select
      id={id}
      value={value ?? ''}
      onChange={(event) => onChange(event.target.value === '' ? null : event.target.value)}
      className={className}
    >
      <option value="">{t('teachers.classroom_account_none')}</option>
      {accounts.items.map((account) => {
        const others = account.teachers.filter((teacher) => teacher.id !== teacherId).length
        const holds = account.teachers.some((teacher) => teacher.id === teacherId)
        const full = others >= accounts.maxTeachers && !holds
        return (
          <option key={account.id} value={account.id} disabled={full}>
            {t(full ? 'teachers.classroom_account_option_full' : 'teachers.classroom_account_option', {
              email: account.email,
              count: others,
              max: accounts.maxTeachers,
            })}
          </option>
        )
      })}
    </select>
  )
}
