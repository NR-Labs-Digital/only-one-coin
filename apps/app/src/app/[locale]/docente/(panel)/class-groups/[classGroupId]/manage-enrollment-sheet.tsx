'use client'

import { useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import type {
  ClassGroupDetail,
  ClassGroupRow,
  ClassGroupStudent,
  ProcedureAction,
} from '@/lib/backoffice/types'
import {
  PROCEDURE_FEE_CENTS,
  procedureBlockReason,
  transferTargets,
} from '@/lib/backoffice/enrollment-procedures'
import { formatMoney, type Locale } from '@/lib/format'
import { StatusBadge } from '@/components/backoffice/ui'
import { BoIcon } from '@/components/backoffice/icons'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'

const ACTIONS: ProcedureAction[] = ['transfer', 'freeze', 'withdraw']

/**
 * Administrative procedures over one enrollment (`docs/REGRAS-NEGOCIO.md` §5).
 *
 * The three of them are arranged outside the platform today — the student pays
 * the fee to Atención al Alumno, sends the receipt, and coordination acts. So
 * this panel deliberately reads as *recording* a procedure, not performing one:
 * each card states the fee and asks for the fee payment to be confirmed before
 * the button unlocks. A backoffice that freezes an enrollment on one click
 * would be quietly giving away a paid procedure.
 *
 * Availability is catalog config (`allowsFreeze`, `allowsTransfer`), never read
 * out of the course name — nothing language-specific in the code (CLAUDE.md
 * §1). Withdrawing has no fee here because the rules define none: there is no
 * cancellation or refund policy on record, which is a gap, not a free pass.
 */
export function ManageEnrollmentSheet({
  student,
  group,
  classGroups,
  onClose,
  onApply,
}: {
  student: ClassGroupStudent | null
  group: ClassGroupDetail
  classGroups: ClassGroupRow[]
  onClose: () => void
  onApply: (student: ClassGroupStudent, action: ProcedureAction) => void
}) {
  const t = useTranslations('bo')
  const locale = useLocale() as Locale
  const [feeConfirmed, setFeeConfirmed] = useState<ProcedureAction | null>(null)
  const [target, setTarget] = useState('')

  const targets = transferTargets(group, classGroups)

  function close() {
    setFeeConfirmed(null)
    setTarget('')
    onClose()
  }

  return (
    <Sheet
      open={student !== null}
      onOpenChange={(open) => {
        if (!open) close()
      }}
    >
      <SheetContent
        side="right"
        closeLabel={t('manage_enrollment.close')}
        className="w-full gap-0 overflow-y-auto bg-white p-0 sm:max-w-md"
      >
        {student && (
          <>
            <SheetHeader className="gap-2 border-b border-line p-5 pr-14">
              <SheetTitle className="text-base font-semibold text-ink">
                {student.fullName}
              </SheetTitle>
              <SheetDescription>
                {t('manage_enrollment.subtitle', { classGroup: group.courseName })}
              </SheetDescription>
              {student.procedure && (
                <StatusBadge
                  tone="neutral"
                  label={t(`enrollment_procedure.${student.procedure}`)}
                />
              )}
            </SheetHeader>

            <div className="flex flex-col gap-3 p-5">
              <p className="flex items-start gap-2 rounded-lg border border-dashed border-line bg-sky-soft px-3 py-2 text-xs text-muted-foreground">
                <BoIcon name="alert" size={14} className="mt-0.5 shrink-0" />
                {t('manage_enrollment.paid_outside')}
              </p>

              {ACTIONS.map((action) => {
                const reason = procedureBlockReason(
                  action,
                  student,
                  group,
                  targets.length,
                )
                const fee = PROCEDURE_FEE_CENTS[action]
                const needsTarget = action === 'transfer'
                const ready =
                  reason === null &&
                  feeConfirmed === action &&
                  (!needsTarget || target !== '')

                return (
                  <div
                    key={action}
                    className="rounded-xl border border-line p-4 transition"
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="text-sm font-semibold text-ink">
                        {t(`enrollment_procedure_action.${action}`)}
                      </p>
                      <span className="text-xs font-semibold tabular-nums text-muted-foreground">
                        {fee === null
                          ? t('manage_enrollment.fee_undefined')
                          : t('manage_enrollment.fee', {
                              amount: formatMoney(fee, 'PEN', locale),
                            })}
                      </span>
                    </div>

                    <p className="mt-1 text-xs text-muted-foreground">
                      {t(`enrollment_procedure_rule.${action}`)}
                    </p>

                    {reason !== null ? (
                      <p className="mt-3 flex items-start gap-2 text-xs font-medium text-muted-foreground">
                        <BoIcon name="close" size={14} className="mt-0.5 shrink-0" />
                        {t(`procedure_block.${reason}`)}
                      </p>
                    ) : (
                      <div className="mt-3 flex flex-col gap-2.5">
                        {needsTarget && (
                          <label className="flex flex-col gap-1">
                            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                              {t('manage_enrollment.target_label')}
                            </span>
                            <select
                              value={target}
                              onChange={(event) => setTarget(event.target.value)}
                              className="rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink outline-none transition focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/15"
                            >
                              <option value="">
                                {t('manage_enrollment.target_placeholder')}
                              </option>
                              {targets.map((row) => (
                                <option key={row.id} value={row.id}>
                                  {`${row.code} · ${row.weekdays
                                    .map((day) => t(`weekday.${day}`))
                                    .join('/')} ${row.startTime} · ${
                                    row.capacity - row.seatsTaken
                                  }`}
                                </option>
                              ))}
                            </select>
                          </label>
                        )}

                        <label className="flex items-start gap-2 text-xs text-ink">
                          <input
                            type="checkbox"
                            checked={feeConfirmed === action}
                            onChange={(event) =>
                              setFeeConfirmed(event.target.checked ? action : null)
                            }
                            className="mt-0.5 h-4 w-4 shrink-0 rounded border-line accent-brand-blue"
                          />
                          {t(
                            fee === null
                              ? 'manage_enrollment.confirm_no_fee'
                              : 'manage_enrollment.confirm_fee',
                          )}
                        </label>

                        <button
                          type="button"
                          disabled={!ready}
                          onClick={() => {
                            onApply(student, action)
                            close()
                          }}
                          className="inline-flex w-fit items-center gap-1.5 rounded-lg bg-brand-blue px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-brand-blue-deep disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-brand-blue"
                        >
                          <BoIcon name="check" size={16} />
                          {t(`enrollment_procedure_confirm.${action}`)}
                        </button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
