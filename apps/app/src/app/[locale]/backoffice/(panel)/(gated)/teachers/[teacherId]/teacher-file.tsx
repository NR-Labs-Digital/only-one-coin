'use client'

import { useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import type {
  AvailabilitySlot,
  CourseLanguage,
  TeacherDetail,
  TeacherStatus,
} from '@/lib/backoffice/types'
import { weekColumns, weeklyHours } from '@/lib/backoffice/availability'
import { COUNTRIES, countryName, flagEmoji } from '@/lib/geo'
import {
  formatDate,
  formatDateRange,
  formatDateTime,
  formatFileSize,
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
import { ContractBadge } from '@/components/backoffice/contract-badge'
import { PhoneField } from '@/components/backoffice/phone-field'
import {
  classGroupTone,
  seatPressureTone,
  teacherTone,
} from '@/components/backoffice/status-tone'
import { BoIcon } from '@/components/backoffice/icons'
import { AvailabilityFields, slotsAreValid } from '../availability-fields'
import { AutoGrid } from '@/components/layout/auto-grid'

type Tab = 'data' | 'availability' | 'class_groups'

const TABS: Tab[] = ['data', 'availability', 'class_groups']

const fieldClass =
  'rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink outline-none transition focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/15'

const labelClass =
  'text-xs font-medium uppercase tracking-wide text-muted-foreground'

/**
 * Teacher file. Three tabs, in the order the record is used: who they are, when
 * they are free, and what is already on them.
 *
 * Edits live in component state only — there is no backend yet, and the real
 * write goes through a usecase in `apps/api`, never from the browser
 * (CLAUDE.md §8). A teacher reading their own file gets it read-only: what they
 * may teach and what they were allocated is coordination's call, not theirs.
 */
export function TeacherFile({
  teacher,
  catalogue,
  canEdit,
}: {
  teacher: TeacherDetail
  /** Every language the catalog offers — what a teacher may be cleared for. */
  catalogue: CourseLanguage[]
  canEdit: boolean
}) {
  const t = useTranslations('bo')
  const locale = useLocale() as Locale
  const [tab, setTab] = useState<Tab>('data')
  const [toast, setToast] = useState<string | null>(null)

  /**
   * On or off the roster. Out of it deletes nothing (`TeacherStatus`) — it is
   * what coordination does when somebody stops teaching: a contract that
   * lapsed, a term that ended. Local state only; the real write is a usecase in
   * `apps/api` and lands in the append-only audit log (CLAUDE.md §8).
   */
  const [status, setStatus] = useState<TeacherStatus>(teacher.status)
  const [confirmingExit, setConfirmingExit] = useState(false)

  const [editingData, setEditingData] = useState(false)
  const [email, setEmail] = useState(teacher.email)
  const [phone, setPhone] = useState(teacher.phone)
  const [nationality, setNationality] = useState(teacher.nationality)
  const [languageIds, setLanguageIds] = useState(
    teacher.languages.map((language) => language.id),
  )

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
  const columns = weekColumns(availability, running)

  const languages = catalogue.filter((language) => languageIds.includes(language.id))

  function saveData() {
    setEditingData(false)
    setToast(t('teacher_file.saved'))
  }

  function cancelData() {
    setEmail(teacher.email)
    setPhone(teacher.phone)
    setNationality(teacher.nationality)
    setLanguageIds(teacher.languages.map((language) => language.id))
    setEditingData(false)
  }

  function saveAvailability() {
    setAvailability(availabilityDraft)
    setEditingAvailability(false)
    setToast(t('teacher_file.saved'))
  }

  function leaveRoster() {
    setStatus('inactive')
    setConfirmingExit(false)
    setToast(t('teacher_file.deactivated_toast'))
  }

  function rejoinRoster() {
    setStatus('active')
    setToast(t('teacher_file.activated_toast'))
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
                {`${flagEmoji(nationality)} ${countryName(nationality, locale)} · ${languages
                  .map((language) => language.name)
                  .join(' · ')}`}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge
              tone={teacherTone[status]}
              label={t(`teacher_status.${status}`)}
            />
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
                  onClick={rejoinRoster}
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
                onClick={leaveRoster}
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
      </Card>

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
                  {teacher.classGroups.length}
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
                  <span className={labelClass}>{t('teachers.field_email')}</span>
                  <input
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    className={fieldClass}
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className={labelClass}>{t('teachers.field_phone')}</span>
                  <PhoneField value={phone} onChange={setPhone} />
                </label>
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
              </AutoGrid>

              <div>
                <p className={`${labelClass} mb-2`}>{t('teachers.field_languages')}</p>
                <div className="flex flex-wrap gap-1.5">
                  {catalogue.map((language) => {
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

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={saveData}
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
              </div>
            </div>
          ) : (
            <AutoGrid as="dl" min="17rem">
              <Field label={t('teachers.field_id_number')}>
                {t('students.document', {
                  type: t(`national_id_type.${teacher.nationalIdType}`),
                  number: teacher.nationalId,
                })}
              </Field>
              <Field label={t('teachers.field_email')}>{email}</Field>
              <Field label={t('teachers.field_phone')}>{phone}</Field>
              <Field label={t('teachers.field_nationality')}>
                {`${flagEmoji(nationality)} ${countryName(nationality, locale)}`}
              </Field>
              {/* Where they live, which the contract is signed against — not
                  the same question as the origin above it. */}
              <Field label={t('teachers.field_address_line')} wrap>
                {[
                  teacher.addressLine,
                  teacher.city,
                  teacher.region,
                  countryName(teacher.country, locale),
                ]
                  .filter(Boolean)
                  .join(' · ')}
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
          <div className="mt-5 border-t border-line pt-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t('teachers.section_contract')}
              </p>
              {/* Nothing to warn about off the roster: the countdown is there
                  to stop somebody teaching on a lapsed contract, and nobody
                  inactive is teaching. The document itself stays on file. */}
              {status === 'active' ? (
                <ContractBadge
                  contract={teacher.contract}
                  daysLeft={teacher.contractDaysLeft}
                />
              ) : (
                <span className="text-xs text-muted-foreground">
                  {t('teachers.contract_inactive')}
                </span>
              )}
            </div>

            {teacher.contract ? (
              <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-line bg-sky-soft px-3 py-2.5">
                <BoIcon name="doc" size={16} className="shrink-0 text-brand-blue" />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-semibold text-ink">
                    {teacher.contract.fileName}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    {t('teachers.contract_file_meta', {
                      date: formatDateTime(teacher.contract.uploadedAt, locale),
                      size: formatFileSize(teacher.contract.fileSizeBytes, locale),
                    })}
                  </span>
                </span>
                <span className="ml-auto text-xs font-medium tabular-nums text-muted-foreground">
                  {formatDateRange(
                    teacher.contract.startsAt,
                    teacher.contract.endsAt,
                    locale,
                  )}
                </span>
              </div>
            ) : (
              <p className="mt-3 text-xs text-muted-foreground">
                {t('teachers.contract_none_body')}
              </p>
            )}
          </div>
        </Card>
      )}

      {tab === 'availability' && (
        <Card className="p-5">
          <div className="mb-1 flex items-center justify-between gap-3">
            <SectionTitle icon="clock">{t('availability.title')}</SectionTitle>
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
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={!slotsAreValid(availabilityDraft)}
                  onClick={saveAvailability}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-brand-blue px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-brand-blue-deep disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <BoIcon name="check" size={16} />
                  {t('teacher_file.save')}
                </button>
                <button
                  type="button"
                  onClick={() => setEditingAvailability(false)}
                  className="rounded-lg border border-line px-3.5 py-2 text-sm font-semibold text-muted-foreground transition hover:text-ink"
                >
                  {t('teacher_file.cancel')}
                </button>
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
              <AutoGrid min="6rem" gap="gap-2">
                {columns.map((column) => (
                  <div
                    key={column.weekday}
                    className="flex flex-col gap-1.5 rounded-lg border border-line bg-sky-soft p-2"
                  >
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {t(`weekday.${column.weekday}`)}
                    </p>

                    {column.slots.length === 0 && column.classes.length === 0 && (
                      <p className="text-xs text-slate-400">—</p>
                    )}

                    {column.slots.map((slot, index) => (
                      <p
                        key={`${slot.startTime}-${index}`}
                        className="rounded border border-dashed border-brand-blue/40 bg-white px-1.5 py-1 text-[11px] font-semibold tabular-nums text-brand-blue-deep"
                      >
                        {`${slot.startTime}–${slot.endTime}`}
                      </p>
                    ))}

                    {column.classes.map((item) => (
                      <Link
                        key={item.id}
                        href={`/backoffice/class-groups/${item.id}`}
                        title={item.courseName}
                        className={`rounded px-1.5 py-1 text-[11px] font-semibold transition ${
                          item.outside
                            ? 'bg-amber-100 text-amber-800 hover:bg-amber-200'
                            : 'bg-brand-blue text-white hover:bg-brand-blue-deep'
                        }`}
                      >
                        <span className="block truncate tabular-nums">
                          {`${item.startTime} · ${item.code}`}
                        </span>
                      </Link>
                    ))}
                  </div>
                ))}
              </AutoGrid>

              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2.5 w-4 rounded border border-dashed border-brand-blue/60 bg-white" />
                  {t('availability.legend_free')}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2.5 w-4 rounded bg-brand-blue" />
                  {t('availability.legend_allocated')}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2.5 w-4 rounded bg-amber-300" />
                  {t('availability.legend_outside')}
                </span>
              </div>
            </>
          )}
        </Card>
      )}

      {tab === 'class_groups' && (
        <Card>
          {teacher.classGroups.length === 0 ? (
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
                {teacher.classGroups.map((group) => (
                  <tr key={group.id}>
                    <td className={`${tdClass} whitespace-nowrap`}>
                      <Link
                        href={`/backoffice/class-groups/${group.id}`}
                        className="font-semibold text-ink transition hover:text-brand-blue"
                      >
                        {group.courseName}
                      </Link>
                      <p className="text-xs tabular-nums text-muted-foreground">
                        {group.code}
                      </p>
                    </td>
                    <td
                      className={`${tdClass} whitespace-nowrap text-sm tabular-nums text-muted-foreground`}
                    >
                      {`${group.weekdays.map((day) => t(`weekday.${day}`)).join('/')} · ${group.startTime}`}
                    </td>
                    <td
                      className={`${tdClass} whitespace-nowrap text-sm text-muted-foreground`}
                    >
                      <span className="flex flex-col leading-tight">
                        <span>{group.academicPeriodName}</span>
                        <span className="text-xs tabular-nums">
                          {formatDateRange(group.startDate, group.endDate, locale)}
                        </span>
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
                        {group.pendingCertificates > 0 && (
                          <span className="text-xs font-semibold text-amber-700">
                            {t('teachers.pending_certificates', {
                              count: group.pendingCertificates,
                            })}
                          </span>
                        )}
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
