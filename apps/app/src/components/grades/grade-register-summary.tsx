'use client'

import { useLocale, useTranslations } from 'next-intl'
import type { GradeRegister } from '@/lib/docente/grade-register'
import { formatDate, formatDateTime, type Locale } from '@/lib/format'
import { StatusBadge } from '@/components/backoffice/ui'
import { registerTone } from './register-tone'
import { BoIcon } from '@/components/backoffice/icons'

/**
 * What a grade register says about itself (OOC-180): its state, how many of
 * the round are graded, the module's end date and the deadline to send it,
 * whether it is out of time, and — returned — what coordination asked to
 * correct. The actions are the caller's.
 */
export function GradeRegisterSummary({ register }: { register: GradeRegister }) {
  const t = useTranslations('bo.grade_register')
  const locale = useLocale() as Locale

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge tone={registerTone[register.status]} label={t(`status.${register.status}`)} />
        {register.overdue && <StatusBadge tone="danger" label={t('overdue')} />}
        {register.submittedLate && register.status !== 'draft' && (
          <StatusBadge tone="warning" label={t('submitted_late')} />
        )}
        {register.round > 1 && (
          <span className="text-xs text-muted-foreground">{t('round', { round: register.round })}</span>
        )}
        <span className="text-xs font-semibold tabular-nums text-muted-foreground">
          {t('progress', { graded: register.graded, total: register.total })}
        </span>
      </div>
      <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {register.moduleEndsOn ? (
          <span>{t('ends_on', { date: formatDate(register.moduleEndsOn, locale) })}</span>
        ) : (
          <span className="font-semibold text-amber-700">{t('no_end_date')}</span>
        )}
        {register.deadlineAt && register.status !== 'official' && (
          <span>
            {t('deadline', {
              date: formatDateTime(register.deadlineAt, locale),
            })}
          </span>
        )}
      </p>
      {register.status === 'returned' && register.returnNote && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
          <BoIcon name="alert" size={14} className="mt-0.5 shrink-0" />
          <span>
            <span className="font-semibold">{t('returned_note_title')}</span>{' '}
            <span className="whitespace-pre-line">{register.returnNote}</span>
          </span>
        </div>
      )}
    </div>
  )
}

/** Who did each step, and when — the register's history. */
export function GradeRegisterSteps({ register }: { register: GradeRegister }) {
  const t = useTranslations('bo.grade_register')
  const locale = useLocale() as Locale
  if (register.steps.length === 0) return null
  return (
    <ol className="flex flex-col gap-1 text-xs text-muted-foreground">
      {register.steps.map((step, index) => (
        <li key={`${step.kind}-${index}`}>
          {t(`step.${step.kind}`, {
            name: step.byName ?? t('unknown_name'),
            date: formatDateTime(step.at, locale),
          })}
          {step.note && <span className="block whitespace-pre-line pl-3 text-ink/80">{step.note}</span>}
        </li>
      ))}
    </ol>
  )
}
