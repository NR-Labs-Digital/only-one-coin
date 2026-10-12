'use client'

import { useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import {
  CityField,
  EmailField,
  type FieldErrorCode,
  isPlausibleAge,
  issueOf,
  NationalIdField,
  nationalIdIssue,
  normalizeNationalId,
  PersonNameField,
  PhoneField as PhoneRule,
} from '@ooc/domain/fields'
import { parseFieldErrors } from '@/lib/field-errors'
import type { GuardianRelationship, NationalIdType, StudentRow } from '@/lib/backoffice/types'
import { ageFrom } from '@/lib/format'
import {
  COUNTRIES,
  DEFAULT_COUNTRY,
  PERU_REGIONS,
  citiesOf,
  countryName,
  flagEmoji,
  splitPhone,
} from '@/lib/geo'
import { Card, OptionalMark, RequiredMark } from '@/components/backoffice/ui'
import { hasPhoneNumber, PhoneField } from '@/components/backoffice/phone-field'
import { Toggle } from '@/components/backoffice/controls'
import { BoIcon } from '@/components/backoffice/icons'
import { AutoGrid } from '@/components/layout/auto-grid'
import { FieldMessage } from './field-message'
import type { EditableStudent } from './[studentId]/student-edit-form'
import type { EditableGuardian } from './[studentId]/guardian-edit-form'

const fieldClass =
  'rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink outline-none transition placeholder:text-muted-foreground focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/15'

const labelClass =
  'flex flex-col gap-1 text-xs font-medium uppercase tracking-wide text-muted-foreground'

const ID_TYPES: NationalIdType[] = ['DNI', 'CE', 'passport']

const RELATIONSHIPS: GuardianRelationship[] = ['mother', 'father', 'legal_guardian']

/** Age of majority in Peru — what makes the guardian mandatory rather than optional. */
const MAJORITY_AGE = 18

const EMPTY_STUDENT: EditableStudent = {
  firstName: '',
  lastName: '',
  nationalIdType: 'DNI',
  nationalId: '',
  email: '',
  phone: '',
  birthDate: '',
  country: DEFAULT_COUNTRY,
  region: null,
  city: '',
}

const EMPTY_GUARDIAN: EditableGuardian = {
  firstName: '',
  lastName: '',
  relationship: 'mother',
  nationalIdType: 'DNI',
  nationalId: '',
  email: '',
  phone: '',
}

function filled(value: string): boolean {
  return value.trim() !== ''
}

/** Problems keyed by the path the API answers with (`student.email`). */
type FormErrors = Partial<Record<string, FieldErrorCode>>

/**
 * The same field rules `POST /students` applies (`@ooc/domain/fields`,
 * OOC-64), so the panel refuses what the API would before a round trip. No
 * Gmail rule here: whether the backoffice is held to it is OOC-65's call.
 */
function personErrors(
  scope: 'student' | 'guardian',
  person: Pick<EditableStudent, 'firstName' | 'lastName' | 'nationalIdType' | 'nationalId' | 'email' | 'phone'>,
): FormErrors {
  const nationalId =
    issueOf(NationalIdField, person.nationalId) ??
    nationalIdIssue(person.nationalIdType, normalizeNationalId(person.nationalId))
  const entries: [string, FieldErrorCode | null][] = [
    ['firstName', issueOf(PersonNameField, person.firstName)],
    ['lastName', issueOf(PersonNameField, person.lastName)],
    ['nationalId', nationalId],
    ['email', issueOf(EmailField, person.email)],
    ['phone', issueOf(PhoneRule, splitPhone(person.phone).number)],
  ]
  const errors: FormErrors = {}
  for (const [field, code] of entries) if (code) errors[`${scope}.${field}`] = code
  return errors
}

/**
 * Registering a student from the panel. This is the flow the enrollment form
 * refuses to do on the side (`new-enrollment-form.tsx`): a person is not a side
 * effect of a seat, because registering one carries the guardian record and the
 * consent behind it (Ley 29733, CLAUDE.md §8).
 *
 * Two things it deliberately does not do:
 *
 * - It does not record consent. Version, timestamp and IP are evidence that a
 *   person accepted a text, and evidence somebody can retype is not evidence —
 *   the same reason `GuardianEditForm` leaves it out. The file starts with
 *   consent pending and the guardian is the one who clears it.
 * - It does not enroll anybody. No course, no class group, no money: those are
 *   the enrollment's, and they freeze a price the moment they are chosen
 *   (CLAUDE.md §5).
 *
 * The guardian is optional, and stops being optional the moment the birth date
 * says the student is a minor — which is most of the public (CLAUDE.md §1). It
 * is not a checkbox the panel can talk itself out of.
 *
 * Screen-local like every other form here: the real write is a usecase in
 * `packages/domain` behind `apps/api`, never the browser (CLAUDE.md §8).
 */
export function NewStudentForm({
  onCancel,
  onCreate,
}: {
  onCancel: () => void
  onCreate: (student: StudentRow) => void
}) {
  const t = useTranslations('bo')
  const locale = useLocale()

  const [student, setStudent] = useState<EditableStudent>(EMPTY_STUDENT)
  const [guardian, setGuardian] = useState<EditableGuardian>(EMPTY_GUARDIAN)
  const [guardianAsked, setGuardianAsked] = useState(false)
  const [pending, setPending] = useState(false)
  /**
   * Which failure, not whether one happened: "ya existe un alumno con este
   * documento" is an instruction (go find them in the directory) and "intenta
   * de nuevo" is not. A discriminated union rather than the API's `reason`
   * string carried into the markup — a domain code never reaches the screen
   * (CLAUDE.md §4).
   */
  const [submitError, setSubmitError] = useState<'none' | 'generic' | 'duplicate' | 'invalid'>('none')
  /** Fields left at least once, and whether a save was attempted — a field's
      error shows from either, never while the first letter is being typed. */
  const [left, setLeft] = useState<ReadonlySet<string>>(() => new Set())
  const [attempted, setAttempted] = useState(false)
  /** What the API refused on the last save; cleared by the next edit. */
  const [serverErrors, setServerErrors] = useState<FormErrors>({})

  function set<K extends keyof EditableStudent>(key: K, next: EditableStudent[K]) {
    setStudent((prev) => ({ ...prev, [key]: next }))
    setServerErrors({})
  }

  function setGuardianField<K extends keyof EditableGuardian>(
    key: K,
    next: EditableGuardian[K],
  ) {
    setGuardian((prev) => ({ ...prev, [key]: next }))
    setServerErrors({})
  }

  /** Blur that leaves the field for good — the phone's dial code and number
      are one field, so moving between them is not leaving. */
  const leave = (path: string) => (event: React.FocusEvent<HTMLElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
    setLeft((prev) => (prev.has(path) ? prev : new Set(prev).add(path)))
  }

  /** Country drives the address cascade: outside Peru there is no region list. */
  function setCountry(next: string) {
    setStudent((prev) => ({ ...prev, country: next, region: null, city: '' }))
  }

  const inPeru = student.country === DEFAULT_COUNTRY
  const cities = citiesOf(student.region)

  /**
   * A birth date that is not filled in yet says nothing about age, so the
   * guardian stays optional until it does — and the moment it says minor, the
   * section opens on its own and cannot be closed again.
   */
  const isMinor = filled(student.birthDate)
    ? ageFrom(student.birthDate) < MAJORITY_AGE
    : false
  const guardianOpen = guardianAsked || isMinor

  const studentReady =
    filled(student.firstName) &&
    filled(student.lastName) &&
    filled(student.nationalId) &&
    filled(student.email) &&
    hasPhoneNumber(student.phone) &&
    filled(student.birthDate) &&
    filled(student.country) &&
    (!inPeru || student.region !== null) &&
    filled(student.city)

  const guardianReady =
    !guardianOpen ||
    (filled(guardian.firstName) &&
      filled(guardian.lastName) &&
      filled(guardian.nationalId) &&
      filled(guardian.email) &&
      hasPhoneNumber(guardian.phone))

  const ready = studentReady && guardianReady

  const birthDateError: FieldErrorCode | null =
    filled(student.birthDate) && !isPlausibleAge(ageFrom(student.birthDate))
      ? 'birth_date_range'
      : null
  const cityError = issueOf(CityField, student.city)
  const errors: FormErrors = {
    ...personErrors('student', student),
    ...(birthDateError ? { 'student.birthDate': birthDateError } : {}),
    ...(cityError ? { 'student.city': cityError } : {}),
    ...(inPeru && student.region === null ? { 'student.region': 'required' as const } : {}),
    ...(guardianOpen ? personErrors('guardian', guardian) : {}),
  }
  const shown = (path: string): FieldErrorCode | undefined =>
    serverErrors[path] ?? (attempted || left.has(path) ? errors[path] : undefined)

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending || !ready) return
    setAttempted(true)
    if (Object.keys(errors).length > 0) return
    setPending(true)
    setSubmitError('none')

    try {
      const response = await fetch('/api/v1/students', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          student: {
            firstName: student.firstName.trim(),
            lastName: student.lastName.trim(),
            nationalIdType: student.nationalIdType,
            nationalId: student.nationalId.trim(),
            email: student.email.trim(),
            phone: student.phone,
            birthDate: student.birthDate,
            country: student.country,
            region: student.region,
            city: student.city.trim(),
          },
          guardian: guardianOpen
            ? {
                firstName: guardian.firstName.trim(),
                lastName: guardian.lastName.trim(),
                relationship: guardian.relationship,
                nationalIdType: guardian.nationalIdType,
                nationalId: guardian.nationalId.trim(),
                email: guardian.email.trim(),
                phone: guardian.phone,
              }
            : null,
        }),
      })

      if (!response.ok) {
        /* The API answers the project's error envelope, `{status, reason}`
           (docs/ARCHITECTURE.md §5.7). Only the one reason this form can act
           on is read; anything else is a failure the person can only retry. */
        const failure = (await response.json().catch(() => null)) as { reason?: string } | null
        /* A field the API refused (OOC-64): shown under that field, in the
           panel's own words — the same rules ran here, so this is a stale
           page or a rule only the server can check. */
        const fields = parseFieldErrors(failure)
        if (fields.length > 0) {
          setServerErrors(Object.fromEntries(fields.map((field) => [field.path, field.code])))
          setSubmitError('invalid')
          return
        }
        setSubmitError(failure?.reason === 'student.already_registered' ? 'duplicate' : 'generic')
        return
      }

      const created = (await response.json()) as { student: { id: string } }
      const now = new Date().toISOString()
      onCreate({
        id: created.student.id,
        firstName: student.firstName.trim(),
        lastName: student.lastName.trim(),
        nationalIdType: student.nationalIdType,
        nationalId: student.nationalId.trim(),
        email: student.email.trim(),
        phone: student.phone,
        birthDate: student.birthDate,
        isMinor,
        /* Derived, never typed (see `StudentStatus`). Registering somebody
           does not enroll them. */
        status: 'no_enrollment',
        country: student.country,
        region: student.region,
        city: student.city.trim(),
        activeCourses: 0,
        totalEnrollments: 0,
        createdAt: now,
        lastActivityAt: now,
      })
    } catch {
      setSubmitError('generic')
    } finally {
      setPending(false)
    }
  }

  return (
    <Card className="p-5">
      <p className="mb-1 text-sm font-semibold text-ink">{t('new_student.title')}</p>
      <p className="mb-4 text-xs text-muted-foreground">{t('new_student.subtitle')}</p>

      <form onSubmit={(event) => void handleSubmit(event)} className="flex flex-col gap-5" noValidate>
        {/* Student */}
        <section className="border-t border-line pt-4">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t('new_student.step_student')}
          </p>

          <AutoGrid min="15rem">
            <label className={labelClass} onBlur={leave('student.firstName')}>
              <span>
                {t('student_file.field_first_name')}
                <RequiredMark label={t('common.required')} />
              </span>
              <input
                className={fieldClass}
                value={student.firstName}
                onChange={(e) => set('firstName', e.target.value)}
                required
              />
              <FieldMessage code={shown('student.firstName')} />
            </label>
            <label className={labelClass} onBlur={leave('student.lastName')}>
              <span>
                {t('student_file.field_last_name')}
                <RequiredMark label={t('common.required')} />
              </span>
              <input
                className={fieldClass}
                value={student.lastName}
                onChange={(e) => set('lastName', e.target.value)}
                required
              />
              <FieldMessage code={shown('student.lastName')} />
            </label>
            <label className={labelClass}>
              <span>
                {t('student_file.field_id_type')}
                <RequiredMark label={t('common.required')} />
              </span>
              <select
                className={fieldClass}
                value={student.nationalIdType}
                onChange={(e) => set('nationalIdType', e.target.value as NationalIdType)}
              >
                {ID_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {t(`national_id_type.${type}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className={labelClass} onBlur={leave('student.nationalId')}>
              <span>
                {t('student_file.field_id_number')}
                <RequiredMark label={t('common.required')} />
              </span>
              <input
                className={`${fieldClass} tabular-nums`}
                value={student.nationalId}
                onChange={(e) => set('nationalId', e.target.value)}
                required
              />
              <FieldMessage code={shown('student.nationalId')} />
            </label>
            <label className={labelClass} onBlur={leave('student.email')}>
              <span>
                {t('student_file.field_email')}
                <RequiredMark label={t('common.required')} />
              </span>
              <input
                type="email"
                className={fieldClass}
                value={student.email}
                onChange={(e) => set('email', e.target.value)}
                required
              />
              <FieldMessage code={shown('student.email')} />
            </label>
            <label className={labelClass} onBlur={leave('student.phone')}>
              <span>
                {t('student_file.field_phone')}
                <RequiredMark label={t('common.required')} />
              </span>
              <PhoneField
                value={student.phone}
                onChange={(next) => set('phone', next)}
                required
              />
              <FieldMessage code={shown('student.phone')} />
            </label>
            {/* The one field that decides whether the guardian is optional. */}
            <label className={labelClass} onBlur={leave('student.birthDate')}>
              <span>
                {t('student_file.field_birth_date')}
                <RequiredMark label={t('common.required')} />
              </span>
              <input
                type="date"
                className={fieldClass}
                value={student.birthDate}
                onChange={(e) => set('birthDate', e.target.value)}
                required
              />
              <FieldMessage code={shown('student.birthDate')} />
            </label>
            <label className={labelClass}>
              <span>
                {t('student_file.field_country')}
                <RequiredMark label={t('common.required')} />
              </span>
              <select
                className={fieldClass}
                value={student.country}
                onChange={(e) => setCountry(e.target.value)}
              >
                {COUNTRIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {`${flagEmoji(c.code)} ${countryName(c.code, locale)}`}
                  </option>
                ))}
              </select>
            </label>
            {inPeru && (
              <label className={labelClass} onBlur={leave('student.region')}>
                <span>
                  {t('student_file.field_region')}
                  <RequiredMark label={t('common.required')} />
                </span>
                <select
                  className={fieldClass}
                  value={student.region ?? ''}
                  onChange={(e) => {
                    set('region', e.target.value || null)
                    set('city', '')
                  }}
                  required
                >
                  <option value="">{t('student_file.select_placeholder')}</option>
                  {PERU_REGIONS.map((r) => (
                    <option key={r.region} value={r.region}>
                      {r.region}
                    </option>
                  ))}
                </select>
                <FieldMessage code={shown('student.region')} />
              </label>
            )}
            <label className={labelClass} onBlur={leave('student.city')}>
              <span>
                {t('student_file.field_city')}
                <RequiredMark label={t('common.required')} />
              </span>
              {inPeru ? (
                <select
                  className={fieldClass}
                  value={student.city}
                  onChange={(e) => set('city', e.target.value)}
                  disabled={cities.length === 0}
                  required
                >
                  <option value="">
                    {cities.length === 0
                      ? t('student_file.city_needs_region')
                      : t('student_file.select_placeholder')}
                  </option>
                  {cities.map((city) => (
                    <option key={city} value={city}>
                      {city}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  className={fieldClass}
                  value={student.city}
                  onChange={(e) => set('city', e.target.value)}
                  required
                />
              )}
              <FieldMessage code={shown('student.city')} />
            </label>
          </AutoGrid>
        </section>

        {/* Guardian */}
        <section className="border-t border-line pt-4">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t('new_student.step_guardian')}
            {!isMinor && <OptionalMark label={t('common.optional')} />}
          </p>

          {isMinor ? (
            /* Not a switch any more: the age decided it, and a toggle that
               cannot be turned off reads as one the panel forgot to disable. */
            <p className="flex items-start gap-2 rounded-lg border border-brand-yellow bg-cream px-3 py-2 text-xs font-medium text-ink">
              <BoIcon name="alert" size={14} className="mt-0.5 shrink-0" />
              {t('new_student.guardian_required_minor')}
            </p>
          ) : (
            <Toggle
              checked={guardianAsked}
              onChange={setGuardianAsked}
              label={t('new_student.guardian_toggle')}
              hint={t('new_student.guardian_optional')}
            />
          )}

          {guardianOpen && (
            <>
              <AutoGrid min="15rem" className="mt-4">
                <label className={labelClass} onBlur={leave('guardian.firstName')}>
                  <span>
                    {t('student_file.field_first_name')}
                    <RequiredMark label={t('common.required')} />
                  </span>
                  <input
                    className={fieldClass}
                    value={guardian.firstName}
                    onChange={(e) => setGuardianField('firstName', e.target.value)}
                    required
                  />
                  <FieldMessage code={shown('guardian.firstName')} />
                </label>
                <label className={labelClass} onBlur={leave('guardian.lastName')}>
                  <span>
                    {t('student_file.field_last_name')}
                    <RequiredMark label={t('common.required')} />
                  </span>
                  <input
                    className={fieldClass}
                    value={guardian.lastName}
                    onChange={(e) => setGuardianField('lastName', e.target.value)}
                    required
                  />
                  <FieldMessage code={shown('guardian.lastName')} />
                </label>
                <label className={labelClass}>
                  <span>
                    {t('student_file.field_relationship')}
                    <RequiredMark label={t('common.required')} />
                  </span>
                  <select
                    className={fieldClass}
                    value={guardian.relationship}
                    onChange={(e) =>
                      setGuardianField(
                        'relationship',
                        e.target.value as GuardianRelationship,
                      )
                    }
                  >
                    {RELATIONSHIPS.map((value) => (
                      <option key={value} value={value}>
                        {t(`relationship.${value}`)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={labelClass}>
                  <span>
                    {t('student_file.field_id_type')}
                    <RequiredMark label={t('common.required')} />
                  </span>
                  <select
                    className={fieldClass}
                    value={guardian.nationalIdType}
                    onChange={(e) =>
                      setGuardianField('nationalIdType', e.target.value as NationalIdType)
                    }
                  >
                    {ID_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {t(`national_id_type.${type}`)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={labelClass} onBlur={leave('guardian.nationalId')}>
                  <span>
                    {t('student_file.field_id_number')}
                    <RequiredMark label={t('common.required')} />
                  </span>
                  <input
                    className={`${fieldClass} tabular-nums`}
                    value={guardian.nationalId}
                    onChange={(e) => setGuardianField('nationalId', e.target.value)}
                    required
                  />
                  <FieldMessage code={shown('guardian.nationalId')} />
                </label>
                <label className={labelClass} onBlur={leave('guardian.email')}>
                  <span>
                    {t('student_file.field_email')}
                    <RequiredMark label={t('common.required')} />
                  </span>
                  <input
                    type="email"
                    className={fieldClass}
                    value={guardian.email}
                    onChange={(e) => setGuardianField('email', e.target.value)}
                    required
                  />
                  <FieldMessage code={shown('guardian.email')} />
                </label>
                <label className={labelClass} onBlur={leave('guardian.phone')}>
                  <span>
                    {t('student_file.field_phone')}
                    <RequiredMark label={t('common.required')} />
                  </span>
                  <PhoneField
                    value={guardian.phone}
                    onChange={(next) => setGuardianField('phone', next)}
                    required
                  />
                  <FieldMessage code={shown('guardian.phone')} />
                </label>
              </AutoGrid>

              <p className="mt-3 flex items-start gap-2 rounded-lg border border-dashed border-line bg-sky-soft px-3 py-2 text-xs text-muted-foreground">
                <BoIcon name="shield" size={14} className="mt-0.5 shrink-0" />
                {t('new_student.consent_notice')}
              </p>
            </>
          )}
        </section>

        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
          <button
            type="submit"
            disabled={!ready || pending}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-blue px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-blue-deep disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-brand-blue"
          >
            <BoIcon name="check" size={16} />
            {pending ? t('student_file.saving') : t('new_student.create')}
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="rounded-lg border border-line px-4 py-2 text-sm font-semibold text-muted-foreground transition hover:text-ink disabled:opacity-60"
          >
            {t('new_student.cancel')}
          </button>
          {/* A button that greys out without saying why reads as broken. */}
          {!ready && (
            <span className="text-xs text-muted-foreground">
              {t('new_student.missing_fields')}
            </span>
          )}
          {submitError !== 'none' && (
            <span className="text-xs font-medium text-red-600">
              {submitError === 'duplicate'
                ? t('new_student.duplicate_error')
                : submitError === 'invalid'
                  ? t('new_student.invalid_error')
                  : t('new_student.submit_error')}
            </span>
          )}
        </div>
      </form>
    </Card>
  )
}
