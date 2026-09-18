'use client'

import { useLocale, useTranslations } from 'next-intl'
import type { EnrollmentHistoryItem } from '@/lib/backoffice/types'
import { formatPaymentMethod } from '@/lib/payment-method'
import { formatDate, formatDateTime, formatMoney, type Locale } from '@/lib/format'
import { Field, Meter, SectionTitle, StatusBadge } from '@/components/backoffice/ui'
import {
  enrollmentTone,
  paymentTone,
  seatTone,
} from '@/components/backoffice/status-tone'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { AutoGrid } from '@/components/layout/auto-grid'

/**
 * Everything behind one row of the enrollment table: class group, money trail
 * and seat state. The table itself carries status only — the detail that used
 * to crowd every cell lives here, one enrollment at a time.
 *
 * Read-only on purpose: approving or rejecting a payment is a `apps/api`
 * usecase with its own audit entry, never a click on a student file.
 */
export function EnrollmentDetailSheet({
  enrollment,
  onClose,
}: {
  enrollment: EnrollmentHistoryItem | null
  onClose: () => void
}) {
  const t = useTranslations('bo')
  const locale = useLocale() as Locale

  return (
    <Sheet
      open={enrollment !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <SheetContent
        side="right"
        closeLabel={t('student_file.detail_close')}
        className="w-full gap-0 overflow-y-auto bg-white p-0 sm:max-w-md"
      >
        {enrollment && (
          <>
            <SheetHeader className="gap-2 border-b border-line p-5 pr-14">
              <SheetTitle className="text-base font-semibold text-ink">
                {enrollment.courseName}
              </SheetTitle>
              <SheetDescription>
                {t('student_file.detail_subtitle', {
                  classGroup: enrollment.classGroupName,
                  teacher: enrollment.teacherName,
                })}
              </SheetDescription>
              <div className="mt-1 flex flex-wrap gap-2">
                <StatusBadge
                  tone={enrollmentTone[enrollment.status]}
                  label={t(`enrollment_status.${enrollment.status}`)}
                />
                <StatusBadge
                  tone={seatTone[enrollment.seatStatus]}
                  dot={false}
                  label={t(`seat_status.${enrollment.seatStatus}`)}
                />
              </div>
            </SheetHeader>

            <div className="flex flex-col gap-6 p-5">
              <section>
                <SectionTitle icon="courses">
                  {t('student_file.section_course')}
                </SectionTitle>
                <AutoGrid as="dl" min="12rem" className="mt-3">
                  <Field label={t('student_file.field_class_group')}>
                    {enrollment.classGroupName}
                  </Field>
                  <Field label={t('student_file.field_teacher')}>
                    {enrollment.teacherName}
                  </Field>
                  <Field label={t('student_file.field_modality')}>
                    {t(`modality.${enrollment.modality}`)}
                  </Field>
                  <Field label={t('student_file.field_period')}>
                    {enrollment.academicPeriodName}
                  </Field>
                  <Field label={t('student_file.field_plan')}>
                    {enrollment.planName}
                  </Field>
                </AutoGrid>
              </section>

              <section>
                <SectionTitle icon="payments">
                  {t('student_file.section_payment')}
                </SectionTitle>
                <AutoGrid as="dl" min="12rem" className="mt-3">
                  <Field label={t('student_file.field_payment_status')}>
                    <StatusBadge
                      tone={paymentTone[enrollment.paymentStatus]}
                      label={t(`payment_status.${enrollment.paymentStatus}`)}
                    />
                  </Field>
                  <Field label={t('student_file.field_payment_method')}>
                    {formatPaymentMethod(
                      enrollment.paymentMethod,
                      enrollment.paymentMethodDetail,
                      t('payment_method.other'),
                    )}
                  </Field>
                  <Field label={t('student_file.field_operation')}>
                    {enrollment.operationNumber ? (
                      <span className="tabular-nums">{enrollment.operationNumber}</span>
                    ) : (
                      t('student_file.no_operation_value')
                    )}
                  </Field>
                  <Field label={t('student_file.field_amount')}>
                    <span className="tabular-nums">
                      {formatMoney(enrollment.amountCents, enrollment.currency, locale)}
                    </span>
                  </Field>
                  <Field label={t('student_file.field_paid_at')}>
                    {enrollment.paidAt
                      ? formatDateTime(enrollment.paidAt, locale)
                      : t('student_file.not_paid')}
                  </Field>
                </AutoGrid>
                <p className="mt-3 text-xs text-muted-foreground">
                  {t('student_file.frozen_price')}
                </p>
              </section>

              <section>
                <SectionTitle icon="enrollments">
                  {t('student_file.section_enrollment')}
                </SectionTitle>
                <AutoGrid as="dl" min="12rem" className="mt-3">
                  <Field label={t('student_file.col_created')}>
                    {formatDate(enrollment.createdAt, locale)}
                  </Field>
                </AutoGrid>
                <div className="mt-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {t('student_file.field_progress')}
                  </p>
                  {enrollment.progressPct === null ? (
                    <p className="mt-1 text-sm text-muted-foreground">
                      {t('student_file.no_progress')}
                    </p>
                  ) : (
                    <>
                      <p className="mt-1 text-sm font-medium text-ink">
                        {t('student_file.progress_value', {
                          pct: enrollment.progressPct,
                        })}
                      </p>
                      <div className="mt-2">
                        <Meter value={enrollment.progressPct} max={100} tone="info" />
                      </div>
                    </>
                  )}
                </div>
              </section>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
