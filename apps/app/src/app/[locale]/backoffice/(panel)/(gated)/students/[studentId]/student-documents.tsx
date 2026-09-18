'use client'

import { useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import type {
  DocumentItem,
  DocumentType,
  StudentDetail,
} from '@/lib/backoffice/types'
import { CONSTANCIA_FEE_CENTS } from '@/lib/backoffice/mock-data'
import {
  formatDate,
  formatDateTime,
  formatFileSize,
  formatMoney,
  type Locale,
} from '@/lib/format'
import { Card, EmptyState, SectionTitle, StatusBadge } from '@/components/backoffice/ui'
import { deliveryTone, documentTone, paymentTone } from '@/components/backoffice/status-tone'
import { BoIcon } from '@/components/backoffice/icons'
import { AutoGrid } from '@/components/layout/auto-grid'

const DOCUMENT_TYPES: DocumentType[] = ['enrollment_certificate', 'certificate']

/**
 * Documents tab of the student file. Three blocks that are deliberately not the
 * same thing:
 *
 * 1. Issued documents — what the institution generates (PDF + verification
 *    code). Issuing one is what sends the e-mail: there is no separate "send"
 *    button, because at 5–7k enrollments a month a per-document send is manual
 *    work nobody will do. A resend is the audited exception.
 * 2. Open requests — the constancia de matrícula is a paid procedure (S/25,
 *    `docs/REGRAS-NEGOCIO.md` §5). It becomes a document only once the receipt
 *    for the fee is approved, through the same OCR ladder as an enrollment.
 * 3. Attached files — uploads from the student or from staff. These carry no
 *    verification code and must never be confused with an issued document.
 *
 * Everything here is screen-local state: the real write goes through
 * `apps/api`, never from the browser (CLAUDE.md §8).
 */
export function StudentDocuments({ student }: { student: StudentDetail }) {
  const t = useTranslations('bo')
  const locale = useLocale() as Locale

  const [documents, setDocuments] = useState<DocumentItem[]>(student.documents)
  const [issuing, setIssuing] = useState(false)
  const [type, setType] = useState<DocumentType>('certificate')
  const [enrollmentId, setEnrollmentId] = useState(
    student.enrollments[0]?.id ?? '',
  )
  /** Last screen-only action, so the mock never pretends something was saved. */
  const [notice, setNotice] = useState<{ key: string; at: string } | null>(null)

  function issue() {
    const now = new Date().toISOString()
    setDocuments((current) => [
      {
        id: `doc_local_${current.length + 1}`,
        type,
        status: 'available',
        enrollmentId,
        issuedAt: now,
        verificationCode: null,
        issuedByName: null,
        delivery: { status: 'queued', lastSentAt: null, attempts: 0 },
      },
      ...current,
    ])
    setIssuing(false)
    setNotice({ key: 'issued_local_only', at: now })
  }

  function resend(id: string) {
    const now = new Date().toISOString()
    setDocuments((current) =>
      current.map((item) =>
        item.id === id
          ? {
              ...item,
              delivery: {
                status: 'queued',
                lastSentAt: item.delivery.lastSentAt,
                attempts: item.delivery.attempts + 1,
              },
            }
          : item,
      ),
    )
    setNotice({ key: 'resent_local_only', at: now })
  }

  const enrollmentLabel = (id: string) => {
    const found = student.enrollments.find((item) => item.id === id)
    return found ? `${found.courseName} · ${found.classGroupName}` : id
  }

  return (
    <div className="flex flex-col gap-4">
      {/* 1. Issued documents */}
      <Card className="p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <SectionTitle icon="doc">{t('student_file.documents_title')}</SectionTitle>
          {!issuing && (
            <button
              type="button"
              onClick={() => setIssuing(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-brand-blue transition hover:bg-sky"
            >
              <BoIcon name="doc" size={14} />
              {t('student_file.issue_document')}
            </button>
          )}
        </div>

        {issuing && (
          <div className="mb-4 rounded-xl border border-line bg-sky-soft p-4">
            <p className="mb-3 text-sm font-semibold text-ink">
              {t('student_file.issue_title')}
            </p>
            <AutoGrid min="18rem" gap="gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {t('student_file.issue_type')}
                </span>
                <select
                  value={type}
                  onChange={(event) => setType(event.target.value as DocumentType)}
                  className="rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/40"
                >
                  {DOCUMENT_TYPES.map((value) => (
                    <option key={value} value={value}>
                      {t(`document_type.${value}`)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {t('student_file.issue_enrollment')}
                </span>
                <select
                  value={enrollmentId}
                  onChange={(event) => setEnrollmentId(event.target.value)}
                  className="rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/40"
                >
                  {student.enrollments.map((item) => (
                    <option key={item.id} value={item.id}>
                      {enrollmentLabel(item.id)}
                    </option>
                  ))}
                </select>
              </label>
            </AutoGrid>

            <p className="mt-3 flex items-start gap-2 text-xs text-muted-foreground">
              <BoIcon name="email" size={14} className="mt-0.5 shrink-0" />
              {t('student_file.issue_email_notice')}
            </p>
            {type === 'enrollment_certificate' && (
              <p className="mt-2 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                <BoIcon name="alert" size={14} className="mt-0.5 shrink-0" />
                {t('student_file.issue_fee_notice', {
                  amount: formatMoney(CONSTANCIA_FEE_CENTS, 'PEN', locale),
                })}
              </p>
            )}

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={issue}
                disabled={enrollmentId === ''}
                className="inline-flex items-center gap-1.5 rounded-lg bg-brand-blue px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-brand-blue-deep disabled:cursor-not-allowed disabled:opacity-50"
              >
                <BoIcon name="check" size={14} />
                {t('student_file.issue_confirm')}
              </button>
              <button
                type="button"
                onClick={() => setIssuing(false)}
                className="rounded-lg border border-line px-3.5 py-2 text-xs font-semibold text-muted-foreground transition hover:text-ink"
              >
                {t('student_file.cancel')}
              </button>
            </div>
          </div>
        )}

        {documents.length === 0 ? (
          <EmptyState
            icon="doc"
            title={t('student_file.no_documents_title')}
            body={t('student_file.no_documents_body')}
          />
        ) : (
          <ul className="divide-y divide-line">
            {documents.map((item) => (
              <li key={item.id} className="flex flex-col gap-2 py-3 first:pt-0">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <span className="flex min-w-0 items-center gap-3">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-sky text-brand-blue">
                      <BoIcon name="doc" size={18} />
                    </span>
                    <span className="flex min-w-0 flex-col leading-tight">
                      <span className="text-sm font-semibold text-ink">
                        {t(`document_type.${item.type}`)}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {item.issuedAt
                          ? t('student_file.issued_at', {
                              date: formatDate(item.issuedAt, locale),
                            })
                          : t('student_file.not_issued')}
                        {item.issuedAt &&
                          ` · ${
                            item.issuedByName
                              ? t('student_file.issued_by', {
                                  name: item.issuedByName,
                                })
                              : t('student_file.issued_by_system')
                          }`}
                      </span>
                    </span>
                  </span>
                  <StatusBadge
                    tone={documentTone[item.status]}
                    label={t(`document_status.${item.status}`)}
                  />
                </div>

                {item.status !== 'locked' && (
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pl-12">
                    {item.verificationCode && (
                      <span className="text-xs text-muted-foreground">
                        {t('student_file.verification_code')}{' '}
                        <span className="font-semibold tabular-nums text-ink">
                          {item.verificationCode}
                        </span>
                      </span>
                    )}

                    <span className="flex items-center gap-1.5">
                      <StatusBadge
                        tone={deliveryTone[item.delivery.status]}
                        label={t(`delivery_status.${item.delivery.status}`)}
                      />
                      <span className="text-xs text-muted-foreground">
                        {item.delivery.lastSentAt
                          ? t('student_file.email_sent_at', {
                              date: formatDate(item.delivery.lastSentAt, locale),
                            })
                          : t('student_file.email_never_sent')}
                        {item.delivery.attempts > 1 &&
                          ` · ${t('student_file.email_attempts', {
                            count: item.delivery.attempts,
                          })}`}
                      </span>
                    </span>

                    <span className="ml-auto flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => resend(item.id)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs font-semibold text-muted-foreground transition hover:bg-sky hover:text-brand-blue"
                      >
                        <BoIcon name="email" size={14} />
                        {t('student_file.resend_email')}
                      </button>
                      <button
                        type="button"
                        onClick={() => setNotice({ key: 'issued_local_only', at: new Date().toISOString() })}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs font-semibold text-brand-blue transition hover:bg-sky"
                      >
                        <BoIcon name="download" size={14} />
                        {t('student_file.download')}
                      </button>
                    </span>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        {notice && (
          <p className="mt-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <BoIcon name="alert" size={14} className="mt-0.5 shrink-0" />
            {t(`student_file.${notice.key}`, {
              time: formatDateTime(notice.at, locale),
            })}
          </p>
        )}
      </Card>

      {/* 2. Paid procedures still on their way to becoming a document */}
      {student.documentRequests.length > 0 && (
        <Card className="p-5">
          <div className="mb-4">
            <SectionTitle icon="payments">
              {t('student_file.requests_title')}
            </SectionTitle>
          </div>
          <ul className="divide-y divide-line">
            {student.documentRequests.map((request) => (
              <li
                key={request.id}
                className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-0"
              >
                <span className="flex min-w-0 flex-col leading-tight">
                  <span className="text-sm font-semibold text-ink">
                    {t(`document_type.${request.type}`)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {[
                      t('student_file.request_requested_at', {
                        date: formatDate(request.requestedAt, locale),
                      }),
                      t('student_file.request_fee', {
                        amount: formatMoney(
                          request.feeCents,
                          request.currency,
                          locale,
                        ),
                      }),
                      request.operationNumber
                        ? t('student_file.request_operation', {
                            number: request.operationNumber,
                          })
                        : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>
                <StatusBadge
                  tone={paymentTone[request.paymentStatus]}
                  label={t(`payment_status.${request.paymentStatus}`)}
                />
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-muted-foreground">
            {t('student_file.request_hint')}
          </p>
        </Card>
      )}

      {/* 3. Uploaded files — never an issued document */}
      <Card className="p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <SectionTitle icon="students">
            {t('student_file.attachments_title')}
          </SectionTitle>
          <button
            type="button"
            onClick={() => setNotice({ key: 'issued_local_only', at: new Date().toISOString() })}
            className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-brand-blue transition hover:bg-sky"
          >
            <BoIcon name="download" size={14} className="rotate-180" />
            {t('student_file.attach_file')}
          </button>
        </div>

        {student.attachments.length === 0 ? (
          <EmptyState
            icon="doc"
            title={t('student_file.no_attachments_title')}
            body={t('student_file.no_attachments_body')}
          />
        ) : (
          <ul className="divide-y divide-line">
            {student.attachments.map((file) => (
              <li
                key={file.id}
                className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0"
              >
                <span className="flex min-w-0 items-center gap-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-500">
                    <BoIcon name="doc" size={18} />
                  </span>
                  <span className="flex min-w-0 flex-col leading-tight">
                    <span className="text-sm font-semibold text-ink">
                      {t(`attachment_kind.${file.kind}`)}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      {file.fileName}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {t('student_file.file_meta', {
                        size: formatFileSize(file.sizeBytes, locale),
                        source: t(`attachment_source.${file.uploadedBy}`),
                        date: formatDate(file.uploadedAt, locale),
                      })}
                    </span>
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => setNotice({ key: 'issued_local_only', at: new Date().toISOString() })}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs font-semibold text-brand-blue transition hover:bg-sky"
                >
                  <BoIcon name="download" size={14} />
                  {t('student_file.download')}
                </button>
              </li>
            ))}
          </ul>
        )}

        <p className="mt-3 flex items-start gap-2 text-xs text-muted-foreground">
          <BoIcon name="shield" size={14} className="mt-0.5 shrink-0" />
          {t('student_file.attachments_hint')}
        </p>
      </Card>
    </div>
  )
}
