'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import {
  issueCertificateBatch,
  type CertificateBatch,
  type CertificateBatchItem,
  type CertificateIssueFailure,
} from '@/lib/backoffice/certificate-batch'
import { formatDate, formatNumber, type Locale } from '@/lib/format'
import { Card, StatusBadge, TableShell, tdClass, thClass } from '@/components/backoffice/ui'
import { Toast } from '@/components/backoffice/controls'

/**
 * The certificate batch of the module group that closes the course (OOC-33):
 * who gets the certificate now, who stays out and why — the API's verdict,
 * never the screen's (CLAUDE.md §8). A person confirms; nothing goes out on a
 * date (CLAUDE.md §1).
 *
 * On a course with the certification exam (Inglés Básico) the exam is not on
 * the platform yet, so coordination marks it passed here, per student; the
 * mark goes into the batch's audit entry. Issuing writes the documents and the
 * e-mails at once and cannot be undone — hence the confirmation.
 */
export function CertificatesCard({
  classGroupId,
  moduleId,
  module,
  batch,
  canIssue,
}: {
  classGroupId: string
  moduleId: string
  /** The module the group teaches — the course's last; null on a single-module course. */
  module: number | null
  /** Null when the API failed. */
  batch: CertificateBatch | null
  canIssue: boolean
}) {
  const t = useTranslations('bo')
  const locale = useLocale() as Locale
  const router = useRouter()
  const [examMarked, setExamMarked] = useState<Set<string>>(new Set())
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<CertificateIssueFailure | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const items = batch?.items ?? []
  const ready = items.filter(
    (item) => item.blockReason === null || (item.blockReason === 'exam_not_approved' && examMarked.has(item.enrollmentId)),
  )
  const canConfirm = canIssue && batch !== null && batch.templatePublished && ready.length > 0

  function toggleExam(enrollmentId: string) {
    setExamMarked((current) => {
      const next = new Set(current)
      if (next.has(enrollmentId)) next.delete(enrollmentId)
      else next.add(enrollmentId)
      return next
    })
    setConfirming(false)
  }

  async function issue() {
    setBusy(true)
    setFailure(null)
    const result = await issueCertificateBatch({
      classGroupId,
      moduleId,
      enrollmentIds: ready.map((item) => item.enrollmentId),
      examApprovedEnrollmentIds: ready
        .filter((item) => item.blockReason === 'exam_not_approved')
        .map((item) => item.enrollmentId),
    })
    setBusy(false)
    setConfirming(false)
    if (!result.ok) {
      setFailure(result.failure)
      return
    }
    setExamMarked(new Set())
    setToast(t('certificates.issued_toast', { count: result.issued }))
    router.refresh()
  }

  const columns = [t('certificates.col_student'), t('certificates.col_grade'), t('certificates.col_status')]

  return (
    <Card className="p-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold text-ink">{t('certificates.title')}</h2>
        <p className="text-sm text-muted-foreground">
          {module === null ? t('certificates.subtitle_single') : t('certificates.subtitle', { module })}
        </p>
      </div>

      {batch === null ? (
        <p role="alert" className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {t('certificates.load_error')}
        </p>
      ) : (
        <>
          {!batch.templatePublished && (
            <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              {t('certificates.template_missing')}
            </p>
          )}
          {batch.examRequired && (
            <p className="mt-4 rounded-lg border border-line bg-sky-soft px-3 py-2 text-sm text-ink">
              {t('certificates.exam_hint')}
            </p>
          )}

          {items.length === 0 ? (
            <p className="mt-4 rounded-xl border border-dashed border-line px-4 py-6 text-center text-sm text-muted-foreground">
              {t('certificates.empty')}
            </p>
          ) : (
            <div className="mt-4">
              <TableShell columns={columns}>
                <thead>
                  <tr>
                    {columns.map((column) => (
                      <th key={column} className={thClass}>
                        {column}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.enrollmentId}>
                      <td className={tdClass}>{item.studentName}</td>
                      <td className={`${tdClass} tabular-nums`}>{gradeLabel(item, t, locale)}</td>
                      <td className={tdClass}>
                        <StatusCell
                          item={item}
                          canMarkExam={canIssue && batch.examRequired}
                          marked={examMarked.has(item.enrollmentId)}
                          onToggleExam={() => toggleExam(item.enrollmentId)}
                          locale={locale}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </TableShell>
            </div>
          )}

          {canIssue && items.length > 0 && (
            <div className="mt-4 flex flex-col gap-3">
              {!confirming ? (
                <button
                  type="button"
                  disabled={!canConfirm}
                  onClick={() => {
                    setFailure(null)
                    setConfirming(true)
                  }}
                  className="inline-flex min-h-tap w-full items-center justify-center rounded-lg bg-brand-blue px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-blue-deep disabled:cursor-not-allowed disabled:opacity-50 sm:w-fit"
                >
                  {t('certificates.issue', { count: ready.length })}
                </button>
              ) : (
                <div className="flex flex-col gap-3 rounded-xl border border-brand-blue/30 bg-sky-soft p-4">
                  <p className="text-sm text-ink">{t('certificates.confirm_body', { count: ready.length })}</p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void issue()}
                      className="inline-flex min-h-tap items-center rounded-lg bg-brand-blue px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-blue-deep disabled:opacity-50"
                    >
                      {busy ? t('certificates.issuing') : t('certificates.confirm')}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setConfirming(false)}
                      className="inline-flex min-h-tap items-center rounded-lg border border-line bg-white px-4 py-2 text-sm font-semibold text-muted-foreground transition hover:text-ink"
                    >
                      {t('certificates.cancel')}
                    </button>
                  </div>
                </div>
              )}
              {failure && (
                <p role="alert" className="text-sm text-red-700">
                  {t(`certificates.error_${failure}`)}
                </p>
              )}
            </div>
          )}
        </>
      )}

      <Toast message={toast} onDismiss={() => setToast(null)} duration={5000} />
    </Card>
  )
}

type Translate = ReturnType<typeof useTranslations<'bo'>>

function gradeLabel(item: CertificateBatchItem, t: Translate, locale: Locale): string {
  const grade = item.lastModuleGrade
  if (grade === null) return '—'
  return grade.didNotSit ? t('certificates.did_not_sit_mark') : formatNumber(grade.score, locale)
}

function StatusCell({
  item,
  canMarkExam,
  marked,
  onToggleExam,
  locale,
}: {
  item: CertificateBatchItem
  canMarkExam: boolean
  marked: boolean
  onToggleExam: () => void
  locale: Locale
}) {
  const t = useTranslations('bo')
  if (item.issued) {
    return (
      <span className="flex flex-col gap-0.5">
        <StatusBadge tone="success" label={t('certificates.status_issued')} />
        <span className="text-xs tabular-nums text-muted-foreground">
          {t('certificates.issued_meta', { code: item.issued.code, date: formatDate(item.issued.issuedAt, locale) })}
        </span>
      </span>
    )
  }
  if (item.blockReason === null) return <StatusBadge tone="info" label={t('certificates.status_ready')} />
  if (item.blockReason === 'exam_not_approved' && canMarkExam) {
    return (
      <label className="flex min-h-tap cursor-pointer items-center gap-2 text-sm text-ink">
        <input
          type="checkbox"
          checked={marked}
          onChange={onToggleExam}
          className="h-4 w-4 rounded border-line text-brand-blue focus-visible:ring-2 focus-visible:ring-brand-blue/40"
        />
        {t('certificates.exam_mark')}
      </label>
    )
  }
  return <StatusBadge tone="neutral" label={t(`certificates.reason.${item.blockReason}`)} />
}
