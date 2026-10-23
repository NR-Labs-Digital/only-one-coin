'use client'

import { useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import type { AvailabilitySlot, CourseLanguage, NationalIdType } from '@/lib/backoffice/types'
import {
  COUNTRIES,
  countryName,
  DEFAULT_COUNTRY,
  PERU_REGIONS,
  citiesOf,
  flagEmoji,
} from '@/lib/geo'
import { Card, OptionalMark, RequiredMark } from '@/components/backoffice/ui'
import { hasPhoneNumber, PhoneField } from '@/components/backoffice/phone-field'
import { BoIcon } from '@/components/backoffice/icons'
import { AvailabilityFields, slotsAreValid } from './availability-fields'
import { AutoGrid } from '@/components/layout/auto-grid'
import { FieldMessage } from '../students/field-message'
import { saveTeacher, type TeacherSaveFailure } from './save-teacher'

const fieldClass =
  'rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink outline-none transition placeholder:text-muted-foreground focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/15'

const labelClass =
  'text-xs font-medium uppercase tracking-wide text-muted-foreground'

const ID_TYPES: NationalIdType[] = ['DNI', 'CE', 'passport']

/**
 * Registering a teacher: who they are on paper, how to reach them, where they
 * live, what they can teach and when they are free (`docs/REQUISITOS.md` RF03).
 *
 * Read top to bottom it answers one question per block, which is why it is cut
 * into blocks: identification, contact, address, teaching. The three short ones
 * are grids of fields; the teaching one holds two lists that grow, and a list
 * that grows next to a field grid is what made this form hard to read.
 *
 * Availability is filled in here rather than left for later because it is the
 * whole reason the record exists on the day it is created — a teacher on the
 * roster with no windows cannot be allocated to anything, so the class group
 * that prompted the hire still has nobody to run it.
 *
 * The contract is filed afterwards, on the teacher's own file (OOC-81) — until
 * then the directory flags the new teacher as "sin contrato", which is the
 * truth.
 *
 * Saves through `POST /teachers` (OOC-78), a usecase in `apps/api` that holds
 * the same field rules and refuses a document already on the roster. Creating
 * the *login* for this teacher is a staff invite, not this form (CLAUDE.md §8).
 */
export function NewTeacherForm({
  languages,
  onCancel,
  onCreate,
}: {
  languages: CourseLanguage[]
  onCancel: () => void
  /** Called with the new file's id once the server saved it. */
  onCreate: (teacherId: string) => void
}) {
  const t = useTranslations('bo')
  const locale = useLocale()

  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [nationalIdType, setNationalIdType] = useState<NationalIdType>('DNI')
  const [nationalId, setNationalId] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [nationality, setNationality] = useState(DEFAULT_COUNTRY)
  const [country, setCountry] = useState(DEFAULT_COUNTRY)
  const [region, setRegion] = useState<string | null>(null)
  const [city, setCity] = useState('')
  const [addressLine, setAddressLine] = useState('')
  const [languageIds, setLanguageIds] = useState<string[]>([])
  const [availability, setAvailability] = useState<AvailabilitySlot[]>([])
  const [pending, setPending] = useState(false)
  const [failure, setFailure] = useState<TeacherSaveFailure | null>(null)

  const inPeru = country === DEFAULT_COUNTRY
  const cities = citiesOf(region)

  const ready =
    firstName.trim() !== '' &&
    lastName.trim() !== '' &&
    nationalId.trim() !== '' &&
    email.trim() !== '' &&
    hasPhoneNumber(phone) &&
    addressLine.trim() !== '' &&
    (!inPeru || region !== null) &&
    city.trim() !== '' &&
    languageIds.length > 0 &&
    slotsAreValid(availability)

  /** The API's refusal for one field, shown under it. */
  const fieldError = (key: string) => (failure?.kind === 'invalid' ? failure.fields[key] : undefined)

  function selectCountry(next: string) {
    setCountry(next)
    setRegion(null)
    setCity('')
  }

  function toggleLanguage(id: string) {
    setLanguageIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    )
  }

  async function submit() {
    if (!ready || pending) return
    setPending(true)
    setFailure(null)

    const result = await saveTeacher<{ id: string }>('/api/v1/teachers', 'POST', {
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      nationalIdType,
      nationalId: nationalId.trim(),
      email: email.trim(),
      phone,
      nationality,
      country,
      region,
      city: city.trim(),
      addressLine: addressLine.trim(),
      languages: languageIds,
      availability,
    })
    setPending(false)

    if (!result.ok) {
      setFailure(result.failure)
      return
    }
    onCreate(result.value.id)
  }

  const failureMessage =
    failure === null
      ? null
      : failure.kind === 'duplicate'
        ? t('teachers.save_error_duplicate')
        : failure.kind === 'invalid'
          ? t('new_student.invalid_error')
          : t('teachers.save_error_generic')

  return (
    <Card className="p-5">
      <p className="mb-1 text-sm font-semibold text-ink">{t('teachers.new_title')}</p>
      <p className="mb-4 text-xs text-muted-foreground">{t('teachers.new_subtitle')}</p>

      {/* Identification */}
      <Block title={t('teachers.section_identity')}>
        <AutoGrid min="15rem" gap="gap-3">
          <Labelled label={t('teachers.field_first_name')} required>
            <input
              value={firstName}
              onChange={(event) => setFirstName(event.target.value)}
              className={fieldClass}
            />
          </Labelled>

          <Labelled label={t('teachers.field_last_name')} required>
            <input
              value={lastName}
              onChange={(event) => setLastName(event.target.value)}
              className={fieldClass}
            />
          </Labelled>

          <Labelled label={t('teachers.field_id_type')} required>
            <select
              value={nationalIdType}
              onChange={(event) =>
                setNationalIdType(event.target.value as NationalIdType)
              }
              className={fieldClass}
            >
              {ID_TYPES.map((type) => (
                <option key={type} value={type}>
                  {t(`national_id_type.${type}`)}
                </option>
              ))}
            </select>
          </Labelled>

          <Labelled label={t('teachers.field_id_number')} required>
            <input
              value={nationalId}
              onChange={(event) => setNationalId(event.target.value)}
              className={`${fieldClass} tabular-nums`}
            />
            <FieldMessage code={fieldError('nationalId')} />
          </Labelled>

          {/* Origin is not residence: the catalog sells the Italian class
              group on its "docente ítalo-peruano"
              (`docs/REGRAS-NEGOCIO.md` §3), and that is this field. */}
          <Labelled label={t('teachers.field_nationality')} required>
            <select
              value={nationality}
              onChange={(event) => setNationality(event.target.value)}
              className={fieldClass}
            >
              {COUNTRIES.map((item) => (
                <option key={item.code} value={item.code}>
                  {`${flagEmoji(item.code)} ${countryName(item.code, locale)}`}
                </option>
              ))}
            </select>
          </Labelled>
        </AutoGrid>
      </Block>

      {/* Contact */}
      <Block title={t('teachers.section_contact')}>
        <AutoGrid min="15rem" gap="gap-3">
          <Labelled label={t('teachers.field_email')} required>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className={fieldClass}
            />
            <FieldMessage code={fieldError('email')} />
          </Labelled>

          <Labelled label={t('teachers.field_phone')} required>
            <PhoneField value={phone} onChange={setPhone} required />
            <FieldMessage code={fieldError('phone')} />
          </Labelled>
        </AutoGrid>
      </Block>

      {/* Address — what the contract is signed against. */}
      <Block title={t('teachers.section_address')} hint={t('teachers.address_hint')}>
        <AutoGrid min="15rem" gap="gap-3">
          <Labelled label={t('teachers.field_country')} required>
            <select
              value={country}
              onChange={(event) => selectCountry(event.target.value)}
              className={fieldClass}
            >
              {COUNTRIES.map((item) => (
                <option key={item.code} value={item.code}>
                  {`${flagEmoji(item.code)} ${countryName(item.code, locale)}`}
                </option>
              ))}
            </select>
          </Labelled>

          {inPeru && (
            <Labelled label={t('teachers.field_region')} required>
              <select
                value={region ?? ''}
                onChange={(event) => {
                  setRegion(event.target.value || null)
                  setCity('')
                }}
                className={fieldClass}
              >
                <option value="">{t('student_file.select_placeholder')}</option>
                {PERU_REGIONS.map((item) => (
                  <option key={item.region} value={item.region}>
                    {item.region}
                  </option>
                ))}
              </select>
            </Labelled>
          )}

          <Labelled label={t('teachers.field_city')} required>
            {inPeru ? (
              <select
                value={city}
                onChange={(event) => setCity(event.target.value)}
                disabled={cities.length === 0}
                className={fieldClass}
              >
                <option value="">
                  {cities.length === 0
                    ? t('student_file.city_needs_region')
                    : t('student_file.select_placeholder')}
                </option>
                {cities.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            ) : (
              <input
                value={city}
                onChange={(event) => setCity(event.target.value)}
                className={fieldClass}
              />
            )}
          </Labelled>

          <Labelled label={t('teachers.field_address_line')} required>
            <input
              value={addressLine}
              onChange={(event) => setAddressLine(event.target.value)}
              placeholder={t('teachers.address_line_placeholder')}
              className={fieldClass}
            />
          </Labelled>
        </AutoGrid>
      </Block>

      {/* Teaching — the two lists, read together because allocation reads them
          together: what they can run, and when they can run it. */}
      <Block title={t('teachers.section_teaching')}>
        <div className="flex flex-col gap-4">
          <fieldset className="rounded-lg border border-line bg-sky-soft/60 p-3">
            <legend className={`px-1 ${labelClass}`}>
              {t('teachers.field_languages')}
              <RequiredMark label={t('common.required')} />
            </legend>
            <p className="mb-2.5 text-xs text-muted-foreground">
              {t('teachers.languages_hint')}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {languages.map((language) => {
                const active = languageIds.includes(language.id)
                return (
                  <button
                    key={language.id}
                    type="button"
                    onClick={() => toggleLanguage(language.id)}
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
          </fieldset>

          <fieldset className="rounded-lg border border-line bg-sky-soft/60 p-3">
            <legend className={`px-1 ${labelClass}`}>
              {t('availability.title')}
              <RequiredMark label={t('common.required')} />
            </legend>
            <p className="mb-2.5 text-xs text-muted-foreground">
              {t('availability.hint')}
            </p>
            <AvailabilityFields value={availability} onChange={setAvailability} />
            <FieldMessage code={fieldError('availability')} />
          </fieldset>
        </div>
      </Block>

      <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-line pt-4">
        <button
          type="button"
          disabled={!ready || pending}
          onClick={() => void submit()}
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand-blue px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-brand-blue-deep disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-brand-blue"
        >
          <BoIcon name="check" size={16} />
          {t('teachers.create')}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-line px-3.5 py-2 text-sm font-semibold text-muted-foreground transition hover:text-ink"
        >
          {t('teachers.cancel')}
        </button>
        {/* A button that greys out without saying why reads as broken. */}
        {!ready && (
          <span className="text-xs text-muted-foreground">
            {t('teachers.missing_fields')}
          </span>
        )}
        {failureMessage && (
          <span role="alert" className="text-xs font-semibold text-red-600">
            {failureMessage}
          </span>
        )}
      </div>
    </Card>
  )
}

/** One question per block, with a rule above it — that is the whole layout. */
function Block({
  title,
  hint,
  children,
}: {
  title: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <section className="mt-5 border-t border-line pt-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      <div className="mt-3">{children}</div>
    </section>
  )
}

function Labelled({
  label,
  required,
  optional,
  children,
}: {
  label: string
  required?: boolean
  optional?: boolean
  children: React.ReactNode
}) {
  const t = useTranslations('bo')
  return (
    <label className="flex flex-col gap-1">
      <span className={labelClass}>
        {label}
        {required && <RequiredMark label={t('common.required')} />}
        {optional && <OptionalMark label={t('common.optional')} />}
      </span>
      {children}
    </label>
  )
}
