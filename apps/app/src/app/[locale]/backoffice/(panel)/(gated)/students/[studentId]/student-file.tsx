'use client'

import { useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import type {
  AuditEntry,
  AuditReference,
  EnrollmentHistoryItem,
  StudentActivityPage,
  StudentDetail,
} from '@/lib/backoffice/types'
import { paymentLedgerSearchParams } from '@/lib/backoffice/payment-ledger-query'
import { Link, useRouter } from '@/i18n/navigation'
import { Toast } from '@/components/backoffice/controls'
import { countryName } from '@/lib/geo'
import { ageFrom, formatDate, formatDateTime, formatMoney, type Locale } from '@/lib/format'
import {
  Card,
  EmptyState,
  Field,
  SectionTitle,
  StatusBadge,
  TableShell,
  tdClass,
  thClass,
} from '@/components/backoffice/ui'
import {
  auditTone,
  enrollmentTone,
  paymentTone,
  seatTone,
} from '@/components/backoffice/status-tone'
import { BoIcon } from '@/components/backoffice/icons'
import { EnrollmentDetailSheet } from './enrollment-detail-sheet'
import { GuardianEditForm, type EditableGuardian } from './guardian-edit-form'
import { StudentDocuments } from './student-documents'
import { StudentEditForm, type EditableStudent } from './student-edit-form'
import { AutoGrid } from '@/components/layout/auto-grid'

type Tab = 'data' | 'enrollments' | 'documents' | 'activity'

/** City · department · country, dropping what is empty or repeated. */
function placeLabel(
  city: string,
  region: string | null,
  country: string,
  locale: string,
): string {
  const parts = [city, region === city ? null : region, countryName(country, locale)]
  return parts.filter(Boolean).join(' · ')
}

const TABS: Tab[] = ['data', 'enrollments', 'documents', 'activity']

/** Where the "add guardian" form starts — consent is never part of it. */
const EMPTY_GUARDIAN: EditableGuardian = {
  firstName: '',
  lastName: '',
  relationship: 'mother',
  nationalIdType: 'DNI',
  nationalId: '',
  email: '',
  phone: '',
}

/**
 * Student file: personal data (editable), enrollment history with the money
 * trail, documents and the audit timeline. Edits are written by `apps/api`
 * (OOC-74), never from the browser (CLAUDE.md §8); after a save the page is
 * refreshed from the server, so the derived figures (minor, status, activity)
 * are the server's, not a guess made here.
 */
export function StudentFile({
  student,
  canViewPayments,
  canEdit,
  activity,
}: {
  student: StudentDetail
  /** Whether the reader's cargo opens Pagos — decides whether the file links there. */
  canViewPayments: boolean
  /** Whether the reader's cargo corrects the file — hides the edit controls otherwise. */
  canEdit: boolean
  /** First page of the timeline; null when the API could not answer. */
  activity: StudentActivityPage | null
}) {
  const t = useTranslations('bo')
  const locale = useLocale() as Locale
  const router = useRouter()
  const [toast, setToast] = useState<string | null>(null)
  const [entries, setEntries] = useState<AuditEntry[]>(activity?.items ?? [])
  const [activityCursor, setActivityCursor] = useState(activity?.nextCursor ?? null)
  const [loadingActivity, setLoadingActivity] = useState(false)

  /*
   * A save refreshes the page from the server, and the timeline's first page
   * comes back with the entry the save just wrote. Taking it over replaces
   * whatever older pages were loaded — they are a click away again.
   */
  const [seenActivity, setSeenActivity] = useState(activity)
  if (activity !== seenActivity) {
    setSeenActivity(activity)
    setEntries(activity?.items ?? [])
    setActivityCursor(activity?.nextCursor ?? null)
  }

  /** The next page of the timeline, through the same-origin proxy. */
  async function loadMoreActivity() {
    if (!activityCursor || loadingActivity) return
    setLoadingActivity(true)
    try {
      const response = await fetch(
        `/api/v1/students/${student.id}/activity?cursor=${encodeURIComponent(activityCursor)}`,
      )
      if (!response.ok) throw new Error(String(response.status))
      const next = (await response.json()) as StudentActivityPage
      setEntries((current) => [...current, ...next.items])
      setActivityCursor(next.nextCursor)
    } catch {
      setToast(t('student_file.activity_load_error'))
    } finally {
      setLoadingActivity(false)
    }
  }
  const [tab, setTab] = useState<Tab>('data')
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<EditableStudent>({
    firstName: student.firstName,
    lastName: student.lastName,
    nationalIdType: student.nationalIdType,
    nationalId: student.nationalId,
    email: student.email,
    phone: student.phone,
    birthDate: student.birthDate,
    country: student.country,
    region: student.region,
    city: student.city,
  })
  const [editingGuardian, setEditingGuardian] = useState(false)
  const [guardianDraft, setGuardianDraft] = useState<EditableGuardian | null>(
    student.guardian
      ? {
          firstName: student.guardian.firstName,
          lastName: student.guardian.lastName,
          relationship: student.guardian.relationship,
          nationalIdType: student.guardian.nationalIdType,
          nationalId: student.guardian.nationalId,
          email: student.guardian.email,
          phone: student.guardian.phone,
        }
      : null,
  )
  /** Read-only next to the editable fields — never part of the draft. */
  const consent = student.guardian?.consent ?? null
  /** Enrollment whose detail panel is open — the table shows status only. */
  const [openEnrollmentId, setOpenEnrollmentId] = useState<string | null>(null)

  /**
   * Pagos filtered down to this enrollment's payment. The ledger has no
   * by-id deep link, so it is searched by what identifies the payment best:
   * the operation number, or the student's name when none was ever written.
   * On the "all" tab: the payment may already be decided, and the default
   * open tab would show an empty list for it.
   */
  function paymentsHref(item: EnrollmentHistoryItem): string | null {
    if (!canViewPayments || item.paymentId === null) return null
    const search = paymentLedgerSearchParams({
      page: 1,
      state: 'all',
      status: null,
      method: null,
      q: item.operationNumber ?? `${student.firstName} ${student.lastName}`,
      sort: 'newest',
    })
    return `/backoffice/payments?${search.toString()}`
  }

  const openEnrollment =
    student.enrollments.find((item) => item.id === openEnrollmentId) ?? null

  /** Audit references carry domain data or a domain code — the screen only ever
   *  shows text (CLAUDE.md §4: zero UI string outside the locale files). */
  function activityDetail(reference: AuditReference): string {
    switch (reference.kind) {
      case 'course':
        return reference.name
      case 'operation':
        return t('student_file.activity_operation', { number: reference.number })
      case 'fields':
        return t('student_file.activity_fields', {
          fields: reference.fields
            .map((field) => t(`student_file.field_${field}`))
            .join(', '),
        })
    }
  }


  return (
    <div className="flex flex-col gap-5">
      {/* Tabs */}
      <div className="flex gap-1 overflow-x-auto border-b border-line [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {TABS.map((value) => {
          const active = tab === value
          return (
            <button
              key={value}
              type="button"
              onClick={() => setTab(value)}
              aria-current={active ? 'page' : undefined}
              className={`-mb-px whitespace-nowrap border-b-2 px-3.5 py-2.5 text-sm font-semibold transition ${
                active
                  ? 'border-brand-blue text-brand-blue'
                  : 'border-transparent text-muted-foreground hover:text-ink'
              }`}
            >
              {t(`student_file.tab_${value}`)}
              {value === 'enrollments' && (
                <span className="ml-1.5 text-xs text-slate-400">
                  {student.enrollments.length}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {tab === 'data' && (
        <div className="flex flex-col gap-4">
          <Card className="p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <SectionTitle icon="students">
                {t('student_file.personal_title')}
              </SectionTitle>
              {canEdit && !editing && (
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-brand-blue transition hover:bg-sky"
                >
                  <BoIcon name="edit" size={14} />
                  {t('student_file.edit')}
                </button>
              )}
            </div>

            {editing ? (
              <StudentEditForm
                studentId={student.id}
                value={draft}
                onCancel={() => setEditing(false)}
                onSave={(next) => {
                  setDraft(next)
                  setEditing(false)
                  setToast(t('student_file.saved'))
                  router.refresh()
                }}
              />
            ) : (
              <>
                <AutoGrid as="dl" min="17rem">
                  <Field label={t('student_file.field_first_name')}>
                    {draft.firstName}
                  </Field>
                  <Field label={t('student_file.field_last_name')}>
                    {draft.lastName}
                  </Field>
                  <Field label={t(`national_id_type.${draft.nationalIdType}`)}>
                    <span className="tabular-nums">{draft.nationalId}</span>
                  </Field>
                  <Field label={t('student_file.field_email')}>{draft.email}</Field>
                  <Field label={t('student_file.field_phone')}>{draft.phone}</Field>
                  <Field label={t('student_file.field_city')}>
                    {placeLabel(draft.city, draft.region, draft.country, locale)}
                  </Field>
                  <Field label={t('student_file.field_birth_date')}>
                    {t('student_file.birth_date_value', {
                      date: formatDate(draft.birthDate, locale),
                      age: ageFrom(draft.birthDate),
                    })}
                  </Field>
                  <Field label={t('student_file.field_created_at')}>
                    {formatDate(student.createdAt, locale)}
                  </Field>
                  <Field label={t('student_file.field_last_activity')}>
                    {formatDateTime(student.lastActivityAt, locale)}
                  </Field>
                </AutoGrid>
              </>
            )}
          </Card>

          {/* Guardian — central flow: most of the audience is a minor. */}
          <Card className="p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <SectionTitle icon="guardian">
                {t('student_file.guardian_title')}
              </SectionTitle>
              {canEdit && !editingGuardian && (
                <button
                  type="button"
                  onClick={() => setEditingGuardian(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-brand-blue transition hover:bg-sky"
                >
                  <BoIcon name={guardianDraft ? 'edit' : 'plus'} size={14} />
                  {guardianDraft ? t('student_file.guardian_edit') : t('student_file.guardian_add')}
                </button>
              )}
            </div>
            {editingGuardian ? (
              <GuardianEditForm
                studentId={student.id}
                value={guardianDraft ?? EMPTY_GUARDIAN}
                onCancel={() => setEditingGuardian(false)}
                onSave={(next) => {
                  setGuardianDraft(next)
                  setEditingGuardian(false)
                  setToast(t('student_file.saved'))
                  router.refresh()
                }}
              />
            ) : guardianDraft ? (
              <>
                <AutoGrid as="dl" min="17rem">
                  <Field label={t('student_file.field_guardian_name')}>
                    {`${guardianDraft.firstName} ${guardianDraft.lastName}`}
                  </Field>
                  <Field label={t('student_file.field_relationship')}>
                    {t(`relationship.${guardianDraft.relationship}`)}
                  </Field>
                  <Field label={t(`national_id_type.${guardianDraft.nationalIdType}`)}>
                    <span className="tabular-nums">{guardianDraft.nationalId}</span>
                  </Field>
                  <Field label={t('student_file.field_email')}>
                    {guardianDraft.email}
                  </Field>
                  <Field label={t('student_file.field_phone')}>
                    {guardianDraft.phone}
                  </Field>
                </AutoGrid>
                {/* Consent is read-only and never part of the edit form: it
                    records that a person accepted a text, not a field staff
                    may set. */}
                <div className="mt-4 rounded-lg border border-line bg-sky-soft p-3">
                  {consent ? (
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <StatusBadge
                        tone="success"
                        label={t('student_file.consent_given')}
                      />
                      <span>
                        {t('student_file.consent_detail', {
                          version: consent.version,
                          date: formatDateTime(consent.acceptedAt, locale),
                          ip: consent.ip,
                        })}
                      </span>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2 text-xs text-amber-800">
                      <StatusBadge
                        tone="warning"
                        label={t('student_file.consent_missing')}
                      />
                      <span>{t('student_file.consent_missing_detail')}</span>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <EmptyState
                icon="guardian"
                title={t('student_file.no_guardian_title')}
                body={
                  student.isMinor
                    ? t('student_file.no_guardian_minor_body')
                    : t('student_file.no_guardian_body')
                }
              />
            )}
          </Card>
        </div>
      )}

      {tab === 'enrollments' && (
        <Card>
          {student.enrollments.length === 0 ? (
            <div className="p-4">
              <EmptyState
                icon="enrollments"
                title={t('student_file.no_enrollments_title')}
                body={t('student_file.no_enrollments_body')}
              />
            </div>
          ) : (
            <TableShell
              columns={[
                t('student_file.col_course'),
                t('student_file.col_period'),
                t('student_file.col_enrollment_status'),
                t('student_file.col_seat'),
                t('student_file.col_payment'),
                t('student_file.col_amount'),
                t('student_file.col_created'),
              ]}
            >
              <thead>
                <tr>
                  <th className={thClass}>{t('student_file.col_course')}</th>
                  <th className={thClass}>{t('student_file.col_period')}</th>
                  <th className={thClass}>{t('student_file.col_enrollment_status')}</th>
                  <th className={thClass}>{t('student_file.col_seat')}</th>
                  <th className={thClass}>{t('student_file.col_payment')}</th>
                  <th className={thClass}>{t('student_file.col_amount')}</th>
                  <th className={thClass}>{t('student_file.col_created')}</th>
                </tr>
              </thead>
              <tbody>
                {student.enrollments.map((item) => (
                  <tr
                    key={item.id}
                    onClick={() => setOpenEnrollmentId(item.id)}
                    title={t('student_file.view_detail')}
                    className="cursor-pointer transition hover:bg-sky-soft"
                  >
                    <td className={tdClass}>
                      {/* The course name is the keyboard-reachable control; the
                          whole row is clickable for the mouse. */}
                      <button
                        type="button"
                        onClick={() => setOpenEnrollmentId(item.id)}
                        className="rounded text-left font-semibold text-ink outline-none transition hover:text-brand-blue focus-visible:ring-2 focus-visible:ring-brand-blue/40"
                      >
                        {item.courseName}
                      </button>
                    </td>
                    <td className={`${tdClass} text-sm text-muted-foreground`}>
                      {item.academicPeriodName}
                    </td>
                    <td className={tdClass}>
                      <StatusBadge
                        tone={enrollmentTone[item.status]}
                        label={t(`enrollment_status.${item.status}`)}
                      />
                    </td>
                    <td className={tdClass}>
                      <StatusBadge
                        tone={seatTone[item.seatStatus]}
                        dot={false}
                        label={t(`seat_status.${item.seatStatus}`)}
                      />
                    </td>
                    <td className={tdClass}>
                      <span className="flex flex-col items-start gap-1">
                        <StatusBadge
                          tone={paymentTone[item.paymentStatus]}
                          label={t(`payment_status.${item.paymentStatus}`)}
                        />
                        {/* Money still open or refused is settled in Pagos,
                            never from the file — the row points the way. */}
                        {item.paymentStatus !== 'approved' && paymentsHref(item) && (
                          <Link
                            href={paymentsHref(item)!}
                            className="text-xs font-semibold text-brand-blue transition hover:text-brand-blue-deep"
                          >
                            {t('student_file.open_in_payments')}
                          </Link>
                        )}
                      </span>
                    </td>
                    <td className={`${tdClass} whitespace-nowrap font-semibold tabular-nums`}>
                      {formatMoney(item.amountCents, item.currency, locale)}
                    </td>
                    <td className={`${tdClass} whitespace-nowrap text-sm text-muted-foreground`}>
                      {formatDate(item.createdAt, locale)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </TableShell>
          )}
          <EnrollmentDetailSheet
            enrollment={openEnrollment}
            paymentsHref={openEnrollment ? paymentsHref(openEnrollment) : null}
            onClose={() => setOpenEnrollmentId(null)}
          />
        </Card>
      )}

      {tab === 'documents' && <StudentDocuments student={student} />}

      {tab === 'activity' && (
        <Card className="p-5">
          <div className="mb-4">
            <SectionTitle icon="clock">{t('student_file.activity_title')}</SectionTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              {t('student_file.activity_subtitle')}
            </p>
          </div>
          {activity === null ? (
            <EmptyState
              icon="alert"
              title={t('student_file.activity_error_title')}
              body={t('student_file.activity_error_body')}
            />
          ) : entries.length === 0 ? (
            <EmptyState
              icon="clock"
              title={t('student_file.no_activity_title')}
              body={t('student_file.no_activity_body')}
            />
          ) : (
            <ol className="flex flex-col">
              {entries.map((entry, index) => (
                <li key={entry.id} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-blue" />
                    {(index < entries.length - 1 || activityCursor) && (
                      <span className="w-px flex-1 bg-line" />
                    )}
                  </div>
                  <div className="flex-1 pb-5">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge
                        tone={auditTone[entry.action]}
                        dot={false}
                        label={t(`audit_action.${entry.action}`)}
                      />
                      <span className="text-xs text-muted-foreground">
                        {formatDateTime(entry.at, locale)}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-ink">
                      {entry.actorName && entry.actorRole
                        ? t('student_file.activity_actor', {
                            actor: entry.actorName,
                            role: t(`role.${entry.actorRole}`),
                          })
                        : t('student_file.activity_actor_unknown')}
                    </p>
                    {entry.reference && (
                      <p className="text-xs text-muted-foreground">
                        {activityDetail(entry.reference)}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          )}
          {activity !== null && activityCursor && (
            <button
              type="button"
              onClick={() => void loadMoreActivity()}
              disabled={loadingActivity}
              className="mt-1 min-h-tap rounded-lg border border-line bg-white px-4 py-2 text-sm font-semibold text-ink transition hover:bg-cream disabled:opacity-50"
            >
              {loadingActivity ? t('student_file.activity_loading') : t('student_file.activity_load_more')}
            </button>
          )}
        </Card>
      )}

      <Toast message={toast} onDismiss={() => setToast(null)} />
    </div>
  )
}
