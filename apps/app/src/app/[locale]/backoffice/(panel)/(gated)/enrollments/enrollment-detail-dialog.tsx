'use client'

import { useLocale, useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import type { EnrollmentRow } from '@/lib/backoffice/types'
import { formatDateTime, formatMoney, type Locale } from '@/lib/format'
import { formatPaymentMethod } from '@/lib/payment-method'
import { SectionTitle, StatusBadge } from '@/components/backoffice/ui'
import {
  enrollmentTone,
  academicTone,
  paymentTone,
  seatTone,
} from '@/components/backoffice/status-tone'
import { BoIcon } from '@/components/backoffice/icons'
import { HelpHint } from '@/components/backoffice/help-hint'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

/**
 * One enrollment, opened from the ledger. Read-only but for the staff's seat
 * tools (OOC-84), offered to whoever may manage enrollments: moving it to
 * another class group (`onMove`), freezing it (`onFreeze`) and bringing a
 * frozen one back (`onReturn`) — and handing it to another student
 * (`onTransfer`, the traspaso of OOC-105). Withdrawing has no rule yet.
 *
 * It exists so the row can stay a row: the teacher, the modality, the ciclo,
 * the frozen price and the operation number are each worth one look and none
 * of them worth a column.
 */
export function EnrollmentDetailDialog({
  enrollment,
  onClose,
  onMove,
  onFreeze,
  onReturn,
  onTransfer,
}: {
  enrollment: EnrollmentRow | null
  onClose: () => void
  /** Present only for a role that may move enrollments. */
  onMove?: (enrollment: EnrollmentRow) => void
  /** The same roles freeze and bring back (OOC-84). */
  onFreeze?: (enrollment: EnrollmentRow) => void
  onReturn?: (enrollment: EnrollmentRow) => void
  /** The same roles hand it to another student (OOC-105). */
  onTransfer?: (enrollment: EnrollmentRow) => void
}) {
  const t = useTranslations('bo')
  const locale = useLocale() as Locale

  return (
    <Dialog
      open={enrollment !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent closeLabel={t('enrollment_detail.close')} className="bg-white">
        {enrollment && (
          <>
            <DialogHeader className="gap-2 border-b border-line p-5 pr-14">
              <DialogTitle className="text-base font-semibold text-ink">
                {enrollment.studentName}
              </DialogTitle>
              <DialogDescription>
                {t('enrollment_detail.subtitle', {
                  course: enrollment.courseName,
                  date: formatDateTime(enrollment.createdAt, locale),
                })}
              </DialogDescription>
              {/* The three states together. Separately each one looks settled;
                  it is the combination — a confirmed seat over an unsettled
                  payment — that tells the reader something is wrong. */}
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <StatusBadge
                  tone={enrollmentTone[enrollment.status]}
                  label={t(`enrollment_status.${enrollment.status}`)}
                />
                <StatusBadge
                  tone={seatTone[enrollment.seatStatus]}
                  label={t(`seat_status.${enrollment.seatStatus}`)}
                />
                {enrollment.academicStatus && (
                  <StatusBadge
                    tone={academicTone[enrollment.academicStatus]}
                    label={t(`academic_status.${enrollment.academicStatus}`)}
                  />
                )}
                <StatusBadge
                  tone={paymentTone[enrollment.paymentStatus]}
                  label={t(`payment_status.${enrollment.paymentStatus}`)}
                />
                <HelpHint
                  what={t('help.enr_detail_badges_what')}
                  how={t('help.enr_detail_badges_how')}
                />
              </div>
            </DialogHeader>

            <div className="flex flex-col gap-6 p-5">
              <section>
                <SectionTitle icon="courses">
                  {t('enrollment_detail.section_course')}
                </SectionTitle>
                <dl className="mt-2">
                  <DataRow
                    label={t('enrollment_detail.field_class_group')}
                    value={enrollment.classGroupName}
                  />
                  <DataRow
                    label={t('enrollment_detail.field_teacher')}
                    value={enrollment.teacherName}
                  />
                  <DataRow
                    label={t('enrollment_detail.field_modality')}
                    value={t(`modality.${enrollment.modality}`)}
                  />
                  {/* Catalogue data, printed as it is stored — a language is
                      never a translated enum (CLAUDE.md §1). */}
                  <DataRow
                    label={t('enrollment_detail.field_language')}
                    value={
                      enrollment.language?.name ??
                      t('enrollment_detail.no_language')
                    }
                  />
                  <DataRow
                    label={t('enrollment_detail.field_period')}
                    value={enrollment.academicPeriodName}
                  />
                  <DataRow
                    label={t('enrollment_detail.field_origin')}
                    value={t(`enrollment_origin.${enrollment.origin}`)}
                  />
                  <DataRow
                    label={t('enrollment_detail.field_progress')}
                    value={
                      enrollment.progressPct === null
                        ? t('enrollment_detail.no_progress')
                        : t('enrollment_detail.progress_value', {
                            pct: enrollment.progressPct,
                          })
                    }
                  />
                </dl>
              </section>

              <section>
                <SectionTitle icon="payments">
                  {t('enrollment_detail.section_payment')}
                </SectionTitle>
                <dl className="mt-2">
                  <DataRow
                    label={t('enrollment_detail.field_plan')}
                    value={enrollment.planName}
                  />
                  <DataRow
                    label={t('enrollment_detail.field_amount')}
                    value={formatMoney(
                      enrollment.amountCents,
                      enrollment.currency,
                      locale,
                    )}
                  />
                  {/* Rail names are proper nouns — never translated
                      (CLAUDE.md §4 glossary); anything else prints what the
                      person who recorded it wrote. */}
                  <DataRow
                    label={t('enrollment_detail.field_method')}
                    value={formatPaymentMethod(
                      enrollment.paymentMethod,
                      enrollment.paymentMethodDetail,
                      t('payment_method.other'),
                    )}
                  />
                  <DataRow
                    label={t('enrollment_detail.field_operation')}
                    value={
                      enrollment.operationNumber ??
                      t('enrollment_detail.no_operation')
                    }
                  />
                  <DataRow
                    label={t('enrollment_detail.field_paid_at')}
                    value={
                      enrollment.paidAt
                        ? formatDateTime(enrollment.paidAt, locale)
                        : t('enrollment_detail.not_paid')
                    }
                  />
                </dl>
                {/* The price version, not the price: correcting the table must
                    never revalidate what was already sold (CLAUDE.md §5). */}
                <p className="mt-2 text-xs text-muted-foreground">
                  {t('enrollment_detail.frozen_price', {
                    id: enrollment.planPriceId,
                  })}
                </p>
              </section>

              <section className="flex flex-col gap-2 border-t border-line pt-4">
                <p className="text-xs text-muted-foreground">
                  {t('enrollment_detail.manage_notice')}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  {onReturn && enrollment.seatStatus === 'frozen' && (
                    <button
                      type="button"
                      onClick={() => onReturn(enrollment)}
                      className="inline-flex min-h-tap items-center gap-1.5 rounded-lg bg-brand-blue px-3 py-2 text-sm font-semibold text-white transition hover:bg-brand-blue-deep"
                    >
                      <BoIcon name="courses" size={16} />
                      {t('freeze_enrollment.return')}
                    </button>
                  )}
                  {onFreeze && enrollment.seatStatus === 'confirmed' && (
                    <button
                      type="button"
                      onClick={() => onFreeze(enrollment)}
                      className="inline-flex min-h-tap items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-sm font-semibold text-ink transition hover:bg-sky-soft"
                    >
                      <BoIcon name="clock" size={16} />
                      {t('freeze_enrollment.freeze')}
                    </button>
                  )}
                  {onTransfer && enrollment.seatStatus === 'confirmed' && (
                    <button
                      type="button"
                      onClick={() => onTransfer(enrollment)}
                      className="inline-flex min-h-tap items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-sm font-semibold text-ink transition hover:bg-sky-soft"
                    >
                      <BoIcon name="students" size={16} />
                      {t('transfer_enrollment.open')}
                    </button>
                  )}
                  {onMove && enrollment.seatStatus !== 'released' && enrollment.seatStatus !== 'frozen' && (
                    <button
                      type="button"
                      onClick={() => onMove(enrollment)}
                      className="inline-flex min-h-tap items-center gap-1.5 rounded-lg bg-brand-blue px-3 py-2 text-sm font-semibold text-white transition hover:bg-brand-blue-deep"
                    >
                      <BoIcon name="courses" size={16} />
                      {t('enrollment_detail.move')}
                    </button>
                  )}
                  <DialogLink
                    href={`/backoffice/students/${enrollment.studentId}`}
                    label={t('enrollment_detail.open_student')}
                    icon="students"
                  />
                  {/* Only when the seat resolves to a class group we can open —
                      a dead link is worse than no link. */}
                  {enrollment.classGroupId && (
                    <DialogLink
                      href={`/backoffice/class-groups/${enrollment.classGroupId}`}
                      label={t('enrollment_detail.open_class_group')}
                      icon="courses"
                    />
                  )}
                </div>
              </section>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

function DataRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line/70 py-2.5 last:border-b-0">
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="text-right text-sm font-medium tabular-nums text-ink">
        {value}
      </dd>
    </div>
  )
}

function DialogLink({
  href,
  label,
  icon,
}: {
  href: string
  label: string
  icon: 'students' | 'courses'
}) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-sm font-semibold text-muted-foreground transition hover:border-brand-blue hover:text-brand-blue"
    >
      <BoIcon name={icon} size={16} />
      {label}
    </Link>
  )
}
