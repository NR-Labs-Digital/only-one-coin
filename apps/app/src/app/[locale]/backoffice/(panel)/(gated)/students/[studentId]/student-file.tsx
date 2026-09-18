'use client'

import { useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import type { AuditReference, StudentDetail } from '@/lib/backoffice/types'
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

/**
 * Student file: personal data (editable), enrollment history with the money
 * trail, documents and the audit timeline. Edits live in component state only —
 * there is no backend yet, and the real write goes through `apps/api`, never
 * from the browser (CLAUDE.md §8).
 */
export function StudentFile({ student }: { student: StudentDetail }) {
  const t = useTranslations('bo')
  const locale = useLocale() as Locale
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
  const [savedAt, setSavedAt] = useState<string | null>(null)
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
  const [guardianSavedAt, setGuardianSavedAt] = useState<string | null>(null)
  /** Read-only next to the editable fields — never part of the draft. */
  const consent = student.guardian?.consent ?? null
  /** Enrollment whose detail panel is open — the table shows status only. */
  const [openEnrollmentId, setOpenEnrollmentId] = useState<string | null>(null)

  /** Audit references carry domain data or a domain code — the screen only ever
   *  shows text (CLAUDE.md §4: zero UI string outside the locale files). */
  function activityDetail(reference: AuditReference): string {
    switch (reference.kind) {
      case 'course':
        return reference.name
      case 'operation':
        return t('student_file.activity_operation', { number: reference.number })
      case 'review_flag':
        return t(`review_flag.${reference.flag}`)
      case 'student_field':
        return t('student_file.activity_field', {
          field: t(`student_file.field_${reference.field}`),
        })
      case 'email_template':
        return t(`email_template.${reference.template}`)
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
              {!editing && (
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
                value={draft}
                onCancel={() => setEditing(false)}
                onSave={(next) => {
                  setDraft(next)
                  setEditing(false)
                  setSavedAt(new Date().toISOString())
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
                {savedAt && (
                  <p className="mt-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    <BoIcon name="alert" size={14} className="mt-0.5 shrink-0" />
                    {t('student_file.saved_local_only', {
                      time: formatDateTime(savedAt, locale),
                    })}
                  </p>
                )}
              </>
            )}
          </Card>

          {/* Guardian — central flow: most of the audience is a minor. */}
          <Card className="p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <SectionTitle icon="guardian">
                {t('student_file.guardian_title')}
              </SectionTitle>
              {guardianDraft && !editingGuardian && (
                <button
                  type="button"
                  onClick={() => setEditingGuardian(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-brand-blue transition hover:bg-sky"
                >
                  <BoIcon name="edit" size={14} />
                  {t('student_file.guardian_edit')}
                </button>
              )}
            </div>
            {guardianDraft ? (
              <>
                {editingGuardian ? (
                  <GuardianEditForm
                    value={guardianDraft}
                    onCancel={() => setEditingGuardian(false)}
                    onSave={(next) => {
                      setGuardianDraft(next)
                      setEditingGuardian(false)
                      setGuardianSavedAt(new Date().toISOString())
                    }}
                  />
                ) : (
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
                )}
                {guardianSavedAt && !editingGuardian && (
                  <p className="mt-4 flex items-start gap-2 rounded-lg border border-dashed border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    <BoIcon name="alert" size={14} className="mt-0.5 shrink-0" />
                    {t('student_file.saved_local_only', {
                      time: formatDateTime(guardianSavedAt, locale),
                    })}
                  </p>
                )}
                {/* Consent stays read-only in both modes: it records that a
                    person accepted a text, not a field staff may set. */}
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
                body={t('student_file.no_guardian_body')}
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
                      <StatusBadge
                        tone={paymentTone[item.paymentStatus]}
                        label={t(`payment_status.${item.paymentStatus}`)}
                      />
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
            enrollment={
              student.enrollments.find((item) => item.id === openEnrollmentId) ?? null
            }
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
          {student.activity.length === 0 ? (
            <EmptyState
              icon="clock"
              title={t('student_file.no_activity_title')}
              body={t('student_file.no_activity_body')}
            />
          ) : (
            <ol className="flex flex-col">
              {student.activity.map((entry, index) => (
                <li key={entry.id} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-blue" />
                    {index < student.activity.length - 1 && (
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
                      {t('student_file.activity_actor', {
                        actor: entry.actorName,
                        role: t(`role.${entry.actorRole}`),
                      })}
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
        </Card>
      )}
    </div>
  )
}
