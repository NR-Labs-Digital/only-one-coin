'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import type { GuardianRelationship, NationalIdType } from '@/lib/backoffice/types'
import { BoIcon } from '@/components/backoffice/icons'
import { PhoneField } from '@/components/backoffice/phone-field'
import { AutoGrid } from '@/components/layout/auto-grid'
import { FieldMessage } from '@/components/backoffice/field-message'
import { saveFile, type SaveFailure } from './save-file'

/**
 * What staff may correct about the guardian. The consent record is deliberately
 * absent: version, timestamp and IP are evidence that a person accepted a text
 * (Ley 29733, CLAUDE.md §8), and evidence you can retype is not evidence.
 */
export interface EditableGuardian {
  firstName: string
  lastName: string
  relationship: GuardianRelationship
  nationalIdType: NationalIdType
  nationalId: string
  email: string
  /** Stored as one string, dial code included — the form only splits it to edit. */
  phone: string
}

const ID_TYPES: NationalIdType[] = ['DNI', 'CE', 'passport']

const RELATIONSHIPS: GuardianRelationship[] = ['mother', 'father', 'legal_guardian']

/**
 * Edit form for the guardian's data — and the way to put one on file when the
 * student has none (the registration that only later learned the age). Saves
 * through `PUT /students/:id/guardian` (OOC-74), a usecase in `apps/api` that
 * writes the change to the append-only audit log; the browser never talks to
 * the database (CLAUDE.md §8). A guardian added here starts with consent
 * pending, like one added at registration.
 */
export function GuardianEditForm({
  studentId,
  value,
  onSave,
  onCancel,
}: {
  studentId: string
  value: EditableGuardian
  onSave: (next: EditableGuardian) => void
  onCancel: () => void
}) {
  const t = useTranslations('bo')
  const [draft, setDraft] = useState<EditableGuardian>(value)
  const [pending, setPending] = useState(false)
  const [failure, setFailure] = useState<SaveFailure | null>(null)

  function set<K extends keyof EditableGuardian>(key: K, next: EditableGuardian[K]) {
    setDraft((prev) => ({ ...prev, [key]: next }))
    setFailure(null)
  }

  /** The API's refusal for one field, shown under it. */
  const fieldError = (key: keyof EditableGuardian) =>
    failure?.kind === 'invalid' ? failure.fields[key] : undefined

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return
    setPending(true)
    setFailure(null)

    const result = await saveFile<EditableGuardian>(`/api/v1/students/${studentId}/guardian`, {
      firstName: draft.firstName.trim(),
      lastName: draft.lastName.trim(),
      relationship: draft.relationship,
      nationalIdType: draft.nationalIdType,
      nationalId: draft.nationalId.trim(),
      email: draft.email.trim(),
      phone: draft.phone,
    })
    setPending(false)

    if (!result.ok) {
      setFailure(result.failure)
      return
    }
    onSave({
      firstName: result.value.firstName,
      lastName: result.value.lastName,
      relationship: result.value.relationship,
      nationalIdType: result.value.nationalIdType,
      nationalId: result.value.nationalId,
      email: result.value.email,
      phone: result.value.phone,
    })
  }

  const failureMessage =
    failure === null
      ? null
      : failure.kind === 'invalid'
        ? t('new_student.invalid_error')
        : t('student_file.save_error_generic')

  const fieldClass =
    'rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink outline-none transition placeholder:text-muted-foreground focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/15'
  const labelClass =
    'flex flex-col gap-1 text-xs font-medium uppercase tracking-wide text-muted-foreground'

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
          {t('student_file.field_relationship')}
          <select
            className={fieldClass}
            value={draft.relationship}
            onChange={(e) => set('relationship', e.target.value as GuardianRelationship)}
          >
            {RELATIONSHIPS.map((value) => (
              <option key={value} value={value}>
                {t(`relationship.${value}`)}
              </option>
            ))}
          </select>
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
      </AutoGrid>

      <p className="flex items-start gap-2 rounded-lg border border-dashed border-line bg-sky-soft px-3 py-2 text-xs text-muted-foreground">
        <BoIcon name="shield" size={14} className="mt-0.5 shrink-0" />
        {t('student_file.guardian_consent_locked')}
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
