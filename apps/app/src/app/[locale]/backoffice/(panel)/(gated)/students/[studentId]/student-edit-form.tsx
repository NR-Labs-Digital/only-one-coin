'use client'

import { useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import type { NationalIdType } from '@/lib/backoffice/types'
import { BoIcon } from '@/components/backoffice/icons'
import { PhoneField } from '@/components/backoffice/phone-field'
import {
  COUNTRIES,
  PERU_REGIONS,
  citiesOf,
  countryName,
  flagEmoji,
} from '@/lib/geo'
import { AutoGrid } from '@/components/layout/auto-grid'
import { FieldMessage } from '@/components/backoffice/field-message'
import { saveFile, type SaveFailure } from './save-file'

export interface EditableStudent {
  firstName: string
  lastName: string
  nationalIdType: NationalIdType
  nationalId: string
  email: string
  /** Stored as one string, dial code included — the form only splits it to edit. */
  phone: string
  birthDate: string
  country: string
  region: string | null
  city: string
}

const ID_TYPES: NationalIdType[] = ['DNI', 'CE', 'passport']

/** What `PUT /students/:id` answers — the record as the server normalized it. */
type SavedStudent = Omit<EditableStudent, 'birthDate'> & { birthDate: string }

/**
 * Edit form for the student's own data. Saves through `PUT /students/:id`
 * (OOC-74) — a usecase in `apps/api` held to registration's rules, which
 * writes the change to the append-only audit log. The browser never talks to
 * the database (CLAUDE.md §8). `onSave` receives the record as the server
 * normalized it, not as it was typed.
 */
export function StudentEditForm({
  studentId,
  value,
  onSave,
  onCancel,
}: {
  studentId: string
  value: EditableStudent
  onSave: (next: EditableStudent) => void
  onCancel: () => void
}) {
  const t = useTranslations('bo')
  const locale = useLocale()
  const [draft, setDraft] = useState<EditableStudent>(value)
  const [pending, setPending] = useState(false)
  const [failure, setFailure] = useState<SaveFailure | null>(null)

  function set<K extends keyof EditableStudent>(key: K, next: EditableStudent[K]) {
    setDraft((prev) => ({ ...prev, [key]: next }))
    setFailure(null)
  }

  /** The API's refusal for one field, shown under it. */
  const fieldError = (key: keyof EditableStudent) =>
    failure?.kind === 'invalid' ? failure.fields[key] : undefined

  /** Country drives the address cascade: outside Peru there is no region list. */
  function setCountry(next: string) {
    setDraft((prev) => ({ ...prev, country: next, region: null, city: '' }))
    setFailure(null)
  }

  const inPeru = draft.country === 'PE'
  const cities = citiesOf(draft.region)

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return
    setPending(true)
    setFailure(null)

    const result = await saveFile<SavedStudent>(`/api/v1/students/${studentId}`, {
      firstName: draft.firstName.trim(),
      lastName: draft.lastName.trim(),
      nationalIdType: draft.nationalIdType,
      nationalId: draft.nationalId.trim(),
      email: draft.email.trim(),
      phone: draft.phone,
      birthDate: draft.birthDate,
      country: draft.country,
      region: draft.region,
      city: draft.city.trim(),
    })
    setPending(false)

    if (!result.ok) {
      setFailure(result.failure)
      return
    }
    // The server answers an ISO timestamp; the form edits a calendar date.
    onSave({ ...result.value, birthDate: result.value.birthDate.slice(0, 10) })
  }

  const failureMessage =
    failure === null
      ? null
      : failure.kind === 'duplicate'
        ? t('student_file.save_error_duplicate')
        : failure.kind === 'guardian_required'
          ? t('student_file.save_error_guardian_required')
          : failure.kind === 'invalid'
            ? t('new_student.invalid_error')
            : t('student_file.save_error_generic')

  const fieldClass =
    'rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink outline-none transition placeholder:text-muted-foreground focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/15'
  const labelClass = 'flex flex-col gap-1 text-xs font-medium uppercase tracking-wide text-muted-foreground'

  return (
    <form onSubmit={(event) => void handleSubmit(event)} className="flex flex-col gap-4" noValidate>
      <AutoGrid min="15rem">
        <label className={labelClass}>
          {t('student_file.field_first_name')}
          <input
            className={fieldClass}
            value={draft.firstName}
            onChange={(e) => set('firstName', e.target.value)}
            required
          />
          <FieldMessage code={fieldError('firstName')} />
        </label>
        <label className={labelClass}>
          {t('student_file.field_last_name')}
          <input
            className={fieldClass}
            value={draft.lastName}
            onChange={(e) => set('lastName', e.target.value)}
            required
          />
          <FieldMessage code={fieldError('lastName')} />
        </label>
        <label className={labelClass}>
          {t('student_file.field_id_type')}
          <select
            className={fieldClass}
            value={draft.nationalIdType}
            onChange={(e) => set('nationalIdType', e.target.value as NationalIdType)}
          >
            {ID_TYPES.map((type) => (
              <option key={type} value={type}>
                {t(`national_id_type.${type}`)}
              </option>
            ))}
          </select>
        </label>
        <label className={labelClass}>
          {t('student_file.field_id_number')}
          <input
            className={`${fieldClass} tabular-nums`}
            value={draft.nationalId}
            onChange={(e) => set('nationalId', e.target.value)}
            required
          />
          <FieldMessage code={fieldError('nationalId')} />
        </label>
        <label className={labelClass}>
          {t('student_file.field_email')}
          <input
            type="email"
            className={fieldClass}
            value={draft.email}
            onChange={(e) => set('email', e.target.value)}
            required
          />
          <FieldMessage code={fieldError('email')} />
        </label>
        <label className={labelClass}>
          {t('student_file.field_phone')}
          <PhoneField
            value={draft.phone}
            onChange={(next) => set('phone', next)}
            required
          />
          <FieldMessage code={fieldError('phone')} />
        </label>
        <label className={labelClass}>
          {t('student_file.field_birth_date')}
          <input
            type="date"
            className={fieldClass}
            value={draft.birthDate}
            onChange={(e) => set('birthDate', e.target.value)}
            required
          />
          <FieldMessage code={fieldError('birthDate')} />
        </label>
        <label className={labelClass}>
          {t('student_file.field_country')}
          <select
            className={fieldClass}
            value={draft.country}
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
          <label className={labelClass}>
            {t('student_file.field_region')}
            <select
              className={fieldClass}
              value={draft.region ?? ''}
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
            <FieldMessage code={fieldError('region')} />
          </label>
        )}
        <label className={labelClass}>
          {t('student_file.field_city')}
          {inPeru ? (
            <select
              className={fieldClass}
              value={draft.city}
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
              value={draft.city}
              onChange={(e) => set('city', e.target.value)}
              required
            />
          )}
          <FieldMessage code={fieldError('city')} />
        </label>
      </AutoGrid>

      <p className="flex items-start gap-2 rounded-lg border border-dashed border-line bg-sky-soft px-3 py-2 text-xs text-muted-foreground">
        <BoIcon name="shield" size={14} className="mt-0.5 shrink-0" />
        {t('student_file.edit_audit_notice')}
      </p>

      {failureMessage && (
        <p role="alert" className="text-xs font-medium text-red-600">
          {failureMessage}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand-blue px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-blue-deep disabled:cursor-not-allowed disabled:opacity-60"
        >
          <BoIcon name="check" size={16} />
          {pending ? t('student_file.saving') : t('student_file.save')}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-lg border border-line px-4 py-2 text-sm font-semibold text-muted-foreground transition hover:bg-sky disabled:opacity-60"
        >
          <BoIcon name="close" size={16} />
          {t('student_file.cancel')}
        </button>
      </div>
    </form>
  )
}
