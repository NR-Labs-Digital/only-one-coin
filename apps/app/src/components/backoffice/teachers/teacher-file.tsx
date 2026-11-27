'use client'

import { useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Link, useRouter } from '@/i18n/navigation'
import type {
  AvailabilitySlot,
  ClassroomAccountList,
  CourseLanguage,
  TeacherDetail,
  TeacherStatus,
} from '@/lib/backoffice/types'
import { weekColumns, weeklyHours } from '@/lib/backoffice/availability'
import { COUNTRIES, countryName, flagEmoji } from '@/lib/geo'
import {
  formatDate,
  formatDateRange,
  initials,
  type Locale,
} from '@/lib/format'
import {
  Card,
  EmptyState,
  Field,
  Meter,
  SectionTitle,
  StatusBadge,
  TableShell,
  tdClass,
  thClass,
} from '@/components/backoffice/ui'
import { Toast } from '@/components/backoffice/controls'
import { PhoneField } from '@/components/backoffice/phone-field'
import {
  classGroupTone,
  seatPressureTone,
  teacherTone,
} from '@/components/backoffice/status-tone'
import { BoIcon } from '@/components/backoffice/icons'
import { HelpHint } from '@/components/backoffice/help-hint'
import { AvailabilityFields, slotsAreValid } from './availability-fields'
import { saveTeacher, type TeacherSaveFailure } from '@/lib/backoffice/save-teacher'
import { FieldMessage } from '../field-message'
import { AutoGrid } from '@/components/layout/auto-grid'
import { ContractSection } from './contract-section'
import { ClassroomAccountSelect } from './classroom-account-select'
import { classroomFailureMessage } from './classroom-failure'
import { WeekGrid } from '@/components/backoffice/week-grid'

type Tab = 'data' | 'availability' | 'class_groups'

const TABS: Tab[] = ['data', 'availability', 'class_groups']

const fieldClass =
  'rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink outline-none transition focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/15'

const labelClass =
  'text-xs font-medium uppercase tracking-wide text-muted-foreground'

/** What every teacher write answers — the file as the server normalized it. */
interface SavedTeacher {
  email: string
  personalEmail: string | null
  classroomAccountId: string | null
  phone: string | null
  nationality: string | null
  languages: string[]
  availability: AvailabilitySlot[]
  status: TeacherStatus
}

/**
 * Teacher file. Three tabs, in the order the record is used: who they are, when
 * they are free, and what is already on them.
 *
 * Every edit saves through `apps/api` (OOC-78) — the data, the week and the
 * place on the roster are three separate writes, each in the audit log
 * (CLAUDE.md §8). Whoever may not edit gets the file read-only: what a teacher
 * may teach and what they were allocated is coordination's call.
 */
const DOCENTE_BASE = '/docente/class-groups'

export function TeacherFile({
  teacher,
  catalogue,
  canEdit,
  canOpenContracts,
  classroomAccounts = null,
  classGroupBase = '/backoffice/class-groups',
}: {
  teacher: TeacherDetail
  /** Every language the catalog offers — what a teacher may be cleared for. */
  catalogue: CourseLanguage[]
  canEdit: boolean
  /** Downloads a filed contract — the roster's readers, not the teacher (OOC-81). */
  canOpenContracts: boolean
  /**
   * The shared Classroom accounts (OOC-196), for the picker. Null when the
   * cargo cannot read them (and in the teacher's own portal): the edit then
   * leaves the account as it is.
   */
  classroomAccounts?: ClassroomAccountList | null
  /**
   * Where a class group of the file opens. The same ficha is read by
   * coordination in the backoffice and by the teacher in their own portal,
   * and each has its own door to a class group.
   */
  classGroupBase?: '/backoffice/class-groups' | '/docente/class-groups'
}) {
  const t = useTranslations('bo')
  const locale = useLocale() as Locale
  const [tab, setTab] = useState<Tab>('data')
  const [toast, setToast] = useState<string | null>(null)

  /**
   * On or off the roster. Out of it deletes nothing (`TeacherStatus`) — it is
   * what coordination does when somebody stops teaching: a contract that
   * lapsed, a term that ended. It also closes the linked panel account, and
   * coming back reopens it.
   */
  const [status, setStatus] = useState<TeacherStatus>(teacher.status)
  const [confirmingExit, setConfirmingExit] = useState(false)
  const [pending, setPending] = useState(false)
  const [failure, setFailure] = useState<TeacherSaveFailure | null>(null)
  const router = useRouter()

  const [editingData, setEditingData] = useState(false)
  const [personalEmail, setPersonalEmail] = useState(teacher.personalEmail ?? '')
  const [classroomAccountId, setClassroomAccountId] = useState(teacher.classroomAccount?.id ?? null)
  const [phone, setPhone] = useState(teacher.phone)
  const [nationality, setNationality] = useState(teacher.nationality)
  const [languageIds, setLanguageIds] = useState(
    teacher.languages.map((language) => language.id),
  )
  /* What the server last saved — the draft above is reset to these. */
  const [saved, setSaved] = useState({
    personalEmail: teacher.personalEmail ?? '',
    classroomAccountId: teacher.classroomAccount?.id ?? null,
    phone: teacher.phone,
    nationality: teacher.nationality,
    languageIds: teacher.languages.map((language) => language.id),
  })

  const [editingAvailability, setEditingAvailability] = useState(false)
  const [availability, setAvailability] = useState<AvailabilitySlot[]>(
    teacher.availability,
  )
  const [availabilityDraft, setAvailabilityDraft] = useState<AvailabilitySlot[]>(
    teacher.availability,
  )

  /* Only class groups that are still running can conflict with a window — a
     finished one is history and would light up the grid forever. */
  const running = teacher.classGroups.filter(
    (group) => group.status === 'enrolling' || group.status === 'in_progress',
  )
  const columns = weekColumns(availability, running, teacher.id)
  /* One row per module run this teacher runs (OOC-156): a class group whose
     other runs are someone else's shows only theirs. */
  const ownRuns = teacher.classGroups.flatMap((group) =>
    group.modules.filter((run) => run.teacherId === teacher.id).map((run) => ({ group, run })),
  )

  /* A language the teacher holds stays listed even if the catalog stopped
     offering it — dropping it from the screen would drop it on the next save. */
  const choices = [
    ...catalogue,
    ...teacher.languages.filter((held) => !catalogue.some((offered) => offered.id === held.id)),
  ]
  const languages = choices.filter((language) => languageIds.includes(language.id))

  const fieldError = (key: string) => (failure?.kind === 'invalid' ? failure.fields[key] : undefined)

  const failureMessage =
    failure === null
      ? null
      : failure.kind === 'duplicate'
        ? t('teachers.save_error_duplicate')
        : failure.kind === 'invalid'
          ? t('new_student.invalid_error')
          : (classroomFailureMessage(failure, t) ?? t('teachers.save_error_generic'))

  /* The file as the server holds it, so a save sends the whole record — PUT,
     not PATCH — with only the fields this tab edits changed. */
  const record = {
    firstName: teacher.firstName,
    lastName: teacher.lastName,
    nationalIdType: teacher.nationalIdType,
    nationalId: teacher.nationalId,
    country: teacher.country,
    region: teacher.region,
    city: teacher.city,
    addressLine: teacher.addressLine,
  }

  async function saveData() {
    if (pending) return
    setPending(true)
    setFailure(null)
    const result = await saveTeacher<SavedTeacher>(`/api/v1/teachers/${teacher.id}`, 'PUT', {
      ...record,
      personalEmail: personalEmail.trim(),
      // Left out without the list: the account stays as it is (OOC-196).
      ...(classroomAccounts ? { classroomAccountId } : {}),
      phone,
      nationality,
      languages: languageIds,
    })
    setPending(false)
    if (!result.ok) {
      setFailure(result.failure)
      return
    }
    const next = {
      personalEmail: result.value.personalEmail ?? '',
      classroomAccountId: result.value.classroomAccountId,
      phone: result.value.phone,
      nationality: result.value.nationality,
      languageIds: result.value.languages,
    }
    setSaved(next)
    setPersonalEmail(next.personalEmail)
    setClassroomAccountId(next.classroomAccountId)
    // The picker's seat counts are the server's; read them again.
    router.refresh()
    setPhone(next.phone)
    setNationality(next.nationality)
    setLanguageIds(next.languageIds)
    setEditingData(false)
    setToast(t('teacher_file.saved'))
  }

  function cancelData() {
    setPersonalEmail(saved.personalEmail)
    setClassroomAccountId(saved.classroomAccountId)
    setPhone(saved.phone)
    setNationality(saved.nationality)
    setLanguageIds(saved.languageIds)
    setFailure(null)
    setEditingData(false)
  }

  async function saveAvailability() {
    if (pending) return
    setPending(true)
    setFailure(null)
    const result = await saveTeacher<SavedTeacher>(`/api/v1/teachers/${teacher.id}/availability`, 'PUT', {
      availability: availabilityDraft,
    })
    setPending(false)
    if (!result.ok) {
      setFailure(result.failure)
      return
    }
    setAvailability(result.value.availability)
    setEditingAvailability(false)
    setToast(t('teacher_file.saved'))
  }

  async function changeStatus(next: TeacherStatus) {
    if (pending) return
    setPending(true)
    setFailure(null)
    const result = await saveTeacher<{ teacher: SavedTeacher }>(`/api/v1/teachers/${teacher.id}/status`, 'PUT', {
      status: next,
    })
    setPending(false)
    if (!result.ok) {
      setFailure(result.failure)
      return
    }
    setStatus(result.value.teacher.status)
    setConfirmingExit(false)
    setToast(t(next === 'inactive' ? 'teacher_file.deactivated_toast' : 'teacher_file.activated_toast'))
    // The roster's tabs and counts read the server; the next visit must too.
    router.refresh()
  }

  const editButton = (onClick: () => void) => (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-sm font-semibold text-muted-foreground transition hover:text-ink"
    >
      <BoIcon name="edit" size={15} />
      {t('teacher_file.edit')}
    </button>
  )

  return (
    <div className="flex flex-col gap-5">
      {/* The header lives here rather than on the page because the status is
          changed from it, and two components owning one status disagree. */}
      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-sky text-base font-semibold text-brand-blue-deep">
              {initials(teacher.firstName, teacher.lastName)}
            </span>
            <div className="min-w-0">
              <h1 className="truncate text-xl font-semibold tracking-tight text-ink">
                {`${teacher.firstName} ${teacher.lastName}`}
              </h1>
              <p className="mt-0.5 truncate text-sm text-muted-foreground">
                {[
                  nationality ? `${flagEmoji(nationality)} ${countryName(nationality, locale)}` : null,
                  ...languages.map((language) => language.name),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge
              tone={teacherTone[status]}
              label={t(`teacher_status.${status}`)}
            />
            {/* Staff's (?): the teacher reading their own file has nothing to change here. */}
            {classGroupBase !== DOCENTE_BASE && (
              <HelpHint what={t('help.teacher_status_what')} how={t('help.teacher_status_how')} />
            )}
            {canEdit &&
              !confirmingExit &&
              (status === 'active' ? (
                <button
                  type="button"
                  onClick={() => setConfirmingExit(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-sm font-semibold text-muted-foreground transition hover:border-red-300 hover:text-red-600"
                >
                  <BoIcon name="close" size={15} />
                  {t('teacher_file.deactivate')}
                </button>
              ) : (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => void changeStatus('active')}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-sm font-semibold text-brand-blue transition hover:border-brand-blue"
                >
                  <BoIcon name="check" size={15} />
                  {t('teacher_file.activate')}
                </button>
              ))}
          </div>
        </div>

        {/* Asked in place rather than in a modal: the consequence is about the
            class groups on this very page, and it is worth reading, not
            dismissing. */}
        {confirmingExit && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50/60 p-3">
            <p className="text-sm font-semibold text-ink">
              {t('teacher_file.deactivate_title')}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {t('teacher_file.deactivate_body')}
            </p>
            {running.length > 0 && (
              <p className="mt-2 flex items-start gap-2 text-xs font-semibold text-red-700">
                <BoIcon name="alert" size={14} className="mt-0.5 shrink-0" />
                {t('teacher_file.deactivate_class_groups', { count: running.length })}
              </p>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={pending}
                onClick={() => void changeStatus('inactive')}
                className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-red-700"
              >
                <BoIcon name="check" size={16} />
                {t('teacher_file.deactivate')}
              </button>
              <button
                type="button"
                onClick={() => setConfirmingExit(false)}
                className="rounded-lg border border-line bg-white px-3.5 py-2 text-sm font-semibold text-muted-foreground transition hover:text-ink"
              >
                {t('teacher_file.cancel')}
              </button>
            </div>
          </div>
        )}

        {failureMessage && !editingData && !editingAvailability && (
          <p role="alert" className="mt-3 text-xs font-semibold text-red-600">
            {failureMessage}
          </p>
        )}
      </Card>

      {/* A file coordination left for the teacher to complete (OOC-103):
          document, phone, origin and address arrive with their onboarding. */}
      {!teacher.profileComplete && (
        <div role="status" className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
          <BoIcon name="clock" size={16} className="mt-0.5 shrink-0 text-amber-700" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-ink">{t('teacher_file.onboarding_pending_title')}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t(
                classGroupBase === DOCENTE_BASE
                  ? 'teacher_file.onboarding_pending_body_self'
                  : 'teacher_file.onboarding_pending_body',
              )}
            </p>
          </div>
        </div>
      )}

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
              {t(`teacher_file.tab_${value}`)}
              {value === 'class_groups' && (
                <span className="ml-1.5 text-xs text-slate-400">
                  {ownRuns.length}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {tab === 'data' && (
        <Card className="p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <SectionTitle icon="teachers">{t('teacher_file.data_title')}</SectionTitle>
            {canEdit && !editingData && editButton(() => setEditingData(true))}
          </div>

          {editingData ? (
            <div className="flex flex-col gap-4">
              <AutoGrid min="15rem" gap="gap-3">
                <label className="flex flex-col gap-1">
                  <span className={labelClass}>{t('teachers.field_personal_email')}</span>
                  <input
                    type="email"
                    value={personalEmail}
                    onChange={(event) => setPersonalEmail(event.target.value)}
                    className={fieldClass}
                  />
                  <span className="text-xs text-muted-foreground">
                    {t('teachers.personal_email_hint')}
                  </span>
                  <FieldMessage code={fieldError('personalEmail')} />
                </label>
                {classroomAccounts && (
                  <div className="flex flex-col gap-1">
                    <span className={`flex items-center gap-1.5 ${labelClass}`}>
                      <label htmlFor="teacher-file-classroom">{t('teachers.field_classroom_account')}</label>
                      <HelpHint
                        what={t('help.teacher_classroom_account_what')}
                        how={t('help.teacher_classroom_account_how')}
                      />
                    </span>
                    <ClassroomAccountSelect
                      id="teacher-file-classroom"
                      accounts={classroomAccounts}
                      value={classroomAccountId}
                      onChange={setClassroomAccountId}
                      teacherId={teacher.id}
                      className={fieldClass}
                    />
                    <FieldMessage code={fieldError('classroomAccountId')} />
                  </div>
                )}
                {/* A pending file's profile is the teacher's to fill (OOC-103):
                    only the e-mail and the languages are coordination's here. */}
                {phone !== null && (
                  <label className="flex flex-col gap-1">
                    <span className={labelClass}>{t('teachers.field_phone')}</span>
                    <PhoneField value={phone} onChange={setPhone} />
                    <FieldMessage code={fieldError('phone')} />
                  </label>
                )}
                {nationality !== null && (
                  <label className="flex flex-col gap-1">
                    <span className={labelClass}>{t('teachers.field_nationality')}</span>
                    <select
                      value={nationality}
                      onChange={(event) => setNationality(event.target.value)}
                      className={fieldClass}
                    >
                      {COUNTRIES.map((country) => (
                        <option key={country.code} value={country.code}>
                          {`${flagEmoji(country.code)} ${countryName(country.code, locale)}`}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </AutoGrid>

              <div>
                <p className={`${labelClass} mb-2 flex items-center gap-1.5`}>
                  {t('teachers.field_languages')}
                  <HelpHint what={t('help.teacher_languages_what')} how={t('help.teacher_languages_how')} />
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {choices.map((language) => {
                    const active = languageIds.includes(language.id)
                    return (
                      <button
                        key={language.id}
                        type="button"
                        onClick={() =>
                          setLanguageIds((current) =>
                            current.includes(language.id)
                              ? current.filter((id) => id !== language.id)
                              : [...current, language.id],
                          )
                        }
                        aria-pressed={active}
                        className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                          active
                            ? 'bg-brand-blue text-white'
                            : 'border border-line bg-white text-muted-foreground hover:bg-cream hover:text-ink'
                        }`}
                      >
                        {active && <BoIcon name="check" size={13} />}
                        {language.name}
                      </button>
                    )
                  })}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={pending || languageIds.length === 0}
                  onClick={() => void saveData()}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-brand-blue px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-brand-blue-deep"
                >
                  <BoIcon name="check" size={16} />
                  {t('teacher_file.save')}
                </button>
                <button
                  type="button"
                  onClick={cancelData}
                  className="rounded-lg border border-line px-3.5 py-2 text-sm font-semibold text-muted-foreground transition hover:text-ink"
                >
                  {t('teacher_file.cancel')}
                </button>
                {failureMessage && (
                  <span role="alert" className="text-xs font-semibold text-red-600">
                    {failureMessage}
                  </span>
                )}
              </div>
            </div>
          ) : (
            <AutoGrid as="dl" min="17rem">
              <Field label={t('teachers.field_id_number')}>
                {teacher.nationalIdType && teacher.nationalId
                  ? t('students.document', {
                      type: t(`national_id_type.${teacher.nationalIdType}`),
                      number: teacher.nationalId,
                    })
                  : t('teacher_file.onboarding_pending_value')}
              </Field>
              <Field label={t('teachers.field_personal_email')}>
                {personalEmail === '' ? (
                  <span className="text-muted-foreground">{t('teachers.personal_email_missing')}</span>
                ) : (
                  personalEmail
                )}
              </Field>
              <Field label={t('teachers.field_classroom_account')}>
                {(() => {
                  const account =
                    classroomAccounts?.items.find((item) => item.id === classroomAccountId) ??
                    (teacher.classroomAccount?.id === classroomAccountId ? teacher.classroomAccount : null)
                  return account ? (
                    account.email
                  ) : (
                    <span className="text-muted-foreground">{t('teachers.classroom_account_none')}</span>
                  )
                })()}
              </Field>
              <Field label={t('teachers.field_phone')}>
                {phone ?? t('teacher_file.onboarding_pending_value')}
              </Field>
              <Field label={t('teachers.field_nationality')}>
                {nationality
                  ? `${flagEmoji(nationality)} ${countryName(nationality, locale)}`
                  : t('teacher_file.onboarding_pending_value')}
              </Field>
              {/* Where they live, which the contract is signed against — not
                  the same question as the origin above it. */}
              <Field label={t('teachers.field_address_line')} wrap>
                {teacher.country
                  ? [
                      teacher.addressLine,
                      teacher.city,
                      teacher.region,
                      countryName(teacher.country, locale),
                    ]
                      .filter(Boolean)
                      .join(' · ')
                  : t('teacher_file.onboarding_pending_value')}
              </Field>
              <Field label={t('teachers.field_languages')}>
                {languages.map((language) => language.name).join(' · ')}
              </Field>
              <Field label={t('teacher_file.joined_at')}>
                {formatDate(teacher.joinedAt, locale)}
              </Field>
              <Field label={t('teacher_file.load')}>
                {t('teacher_file.load_value', {
                  groups: teacher.activeClassGroups,
                  students: teacher.studentCount,
                })}
              </Field>
            </AutoGrid>
          )}

          {/* The contract, on the same tab as the person it binds. Its own
              block rather than a field, because "no contract on file" has to
              read as a finding and not as an empty cell. */}
          <ContractSection
            teacher={teacher}
            status={status}
            canEdit={canEdit}
            canOpen={canOpenContracts}
          />
        </Card>
      )}

      {tab === 'availability' && (
        <Card className="p-5">
          <div className="mb-1 flex items-center justify-between gap-3">
            <span className="flex items-center gap-1.5">
              <SectionTitle icon="clock">{t('availability.title')}</SectionTitle>
              {classGroupBase !== DOCENTE_BASE && (
                <HelpHint
                  what={t('help.teacher_availability_what')}
                  how={t('help.teacher_availability_how')}
                />
              )}
            </span>
            {canEdit &&
              !editingAvailability &&
              editButton(() => {
                setAvailabilityDraft(availability)
                setEditingAvailability(true)
              })}
          </div>
          <p className="mb-4 text-xs text-muted-foreground">
            {t('availability.weekly_hours', { hours: weeklyHours(availability) })}
          </p>

          {editingAvailability ? (
            <div className="flex flex-col gap-4">
              <AvailabilityFields
                value={availabilityDraft}
                onChange={setAvailabilityDraft}
              />
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={pending || !slotsAreValid(availabilityDraft)}
                  onClick={() => void saveAvailability()}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-brand-blue px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-brand-blue-deep disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <BoIcon name="check" size={16} />
                  {t('teacher_file.save')}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setFailure(null)
                    setEditingAvailability(false)
                  }}
                  className="rounded-lg border border-line px-3.5 py-2 text-sm font-semibold text-muted-foreground transition hover:text-ink"
                >
                  {t('teacher_file.cancel')}
                </button>
                <FieldMessage code={fieldError('availability')} />
                {failureMessage && (
                  <span role="alert" className="text-xs font-semibold text-red-600">
                    {failureMessage}
                  </span>
                )}
              </div>
            </div>
          ) : availability.length === 0 ? (
            <EmptyState
              icon="clock"
              title={t('availability.none_title')}
              body={t('availability.none_body')}
            />
          ) : (
            <>
              {/* The week, with what was already allocated laid on top: the
                  question this answers is where the next class group fits,
                  not what the teacher wrote down. */}
              <WeekGrid
                columns={columns}
                hrefOf={(id, runId) => `${classGroupBase}/${classGroupBase === DOCENTE_BASE ? runId : id}`}
              />
            </>
          )}
        </Card>
      )}

      {tab === 'class_groups' && (
        <Card>
          {ownRuns.length === 0 ? (
            <div className="p-4">
              <EmptyState
                icon="courses"
                title={t('teacher_file.no_class_groups_title')}
                body={t('teacher_file.no_class_groups_body')}
              />
            </div>
          ) : (
            <TableShell
              columns={[
                t('teacher_file.col_class_group'),
                t('teacher_file.col_schedule'),
                t('teacher_file.col_period'),
                t('teacher_file.col_seats'),
                t('teacher_file.col_status'),
              ]}
            >
              <thead>
                <tr>
                  <th className={thClass}>{t('teacher_file.col_class_group')}</th>
                  <th className={thClass}>{t('teacher_file.col_schedule')}</th>
                  <th className={thClass}>{t('teacher_file.col_period')}</th>
                  <th className={thClass}>{t('teacher_file.col_seats')}</th>
                  <th className={thClass}>{t('teacher_file.col_status')}</th>
                </tr>
              </thead>
              <tbody>
                {ownRuns.map(({ group, run }) => (
                  <tr key={run.id}>
                    <td className={`${tdClass} whitespace-nowrap`}>
                      <Link
                        href={`${classGroupBase}/${classGroupBase === DOCENTE_BASE ? run.id : group.id}`}
                        className="font-semibold text-ink transition hover:text-brand-blue"
                      >
                        {group.courseName}
                      </Link>
                      <p className="text-xs tabular-nums text-muted-foreground">
                        {run.module === null
                          ? group.code
                          : t('class_group_runs.code_with_module', { code: group.code, number: run.module })}
                      </p>
                    </td>
                    <td
                      className={`${tdClass} whitespace-nowrap text-sm tabular-nums text-muted-foreground`}
                    >
                      <span className="flex flex-col leading-tight">
                        {run.slots.map((slot) => (
                          <span key={`${slot.weekday}-${slot.startTime}`}>
                            {`${t(`weekday.${slot.weekday}`)} ${slot.startTime}–${slot.endTime}`}
                          </span>
                        ))}
                      </span>
                    </td>
                    <td
                      className={`${tdClass} whitespace-nowrap text-sm text-muted-foreground`}
                    >
                      <span className="flex flex-col leading-tight">
                        <span>{group.academicPeriodName}</span>
                        {group.startsOn && group.endsOn && (
                          <span className="text-xs tabular-nums">
                            {formatDateRange(group.startsOn, group.endsOn, locale)}
                          </span>
                        )}
                      </span>
                    </td>
                    <td className={`${tdClass} min-w-32`}>
                      <span className="flex flex-col gap-1">
                        <span className="text-xs tabular-nums text-muted-foreground">
                          {t('seats.taken', {
                            taken: group.seatsTaken,
                            capacity: group.capacity,
                          })}
                        </span>
                        <Meter
                          value={group.seatsTaken}
                          max={group.capacity}
                          tone={seatPressureTone(group.seatsTaken, group.capacity)}
                        />
                      </span>
                    </td>
                    <td className={tdClass}>
                      <span className="flex flex-col items-start gap-1">
                        <StatusBadge
                          tone={classGroupTone[group.status]}
                          label={t(`class_group_status.${group.status}`)}
                        />
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </TableShell>
          )}
        </Card>
      )}

      <Toast message={toast} onDismiss={() => setToast(null)} />
    </div>
  )
}
