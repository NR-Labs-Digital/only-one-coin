'use client'

import { useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import type {
  AvailabilitySlot,
  CourseLanguage,
  NationalIdType,
  TeacherContract,
  TeacherRow,
} from '@/lib/backoffice/types'
import { CONTRACT_ALERT_DAYS, daysUntil } from '@/lib/backoffice/contract'
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

const fieldClass =
  'rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink outline-none transition placeholder:text-muted-foreground focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/15'

const labelClass =
  'text-xs font-medium uppercase tracking-wide text-muted-foreground'

const ID_TYPES: NationalIdType[] = ['DNI', 'CE', 'passport']

/** A placeholder size, until a real upload reports one (no storage is wired). */
const MOCK_FILE_SIZE_BYTES = 180_224

/**
 * Registering a teacher: who they are on paper, how to reach them, where they
 * live, what they can teach, when they are free, and the contract behind all of
 * it (`docs/REQUISITOS.md` RF03).
 *
 * Read top to bottom it answers one question per block, which is why it is cut
 * into blocks: identification, contact, address, teaching, contract. The three
 * short ones are grids of fields; the two long ones are lists that grow, and a
 * list that grows next to a field grid is what made this form hard to read.
 *
 * Availability is filled in here rather than left for later because it is the
 * whole reason the record exists on the day it is created — a teacher on the
 * roster with no windows cannot be allocated to anything, so the class group
 * that prompted the hire still has nobody to run it.
 *
 * The contract is a file plus the window it covers. The panel does not draft it
 * — generating it from the Asociación's template is its own step, and this form
 * only files what was signed. What the dates buy is the warning: the directory
 * goes amber before a contract lapses, instead of after somebody notices.
 *
 * Screen-local, like the course and class group forms: the real write is a
 * usecase in `packages/domain` behind `apps/api`, never the browser
 * (CLAUDE.md §8). Creating the *login* for this teacher is a separate,
 * admin-only usecase with fresh re-authentication (CLAUDE.md §8) — not this
 * form.
 */
export function NewTeacherForm({
  languages,
  onCancel,
  onCreate,
}: {
  languages: CourseLanguage[]
  onCancel: () => void
  onCreate: (teacher: TeacherRow) => void
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
  const [contractFileName, setContractFileName] = useState('')
  const [contractStartsAt, setContractStartsAt] = useState('')
  const [contractEndsAt, setContractEndsAt] = useState('')

  const inPeru = country === DEFAULT_COUNTRY
  const cities = citiesOf(region)

  /**
   * A contract is all three things or none: a file nobody dated cannot be
   * chased, and a window with no file behind it is a promise the Asociación
   * cannot produce. Filing it later is allowed — leaving it half-filed is not.
   */
  const contractStarted =
    contractFileName !== '' || contractStartsAt !== '' || contractEndsAt !== ''
  const contractComplete =
    contractFileName !== '' && contractStartsAt !== '' && contractEndsAt !== ''
  const contractDatesOrdered =
    !contractComplete || contractStartsAt < contractEndsAt
  const contractReady = !contractStarted || (contractComplete && contractDatesOrdered)

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
    slotsAreValid(availability) &&
    contractReady

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

  function submit() {
    if (!ready) return
    const now = new Date()
    /* No storage is wired yet: in production the file goes to the bucket
       through a signed URL and never through the app (CLAUDE.md §5), and the
       row keeps the name it was filed under. */
    const contract: TeacherContract | null = contractComplete
      ? {
          fileName: contractFileName,
          fileSizeBytes: MOCK_FILE_SIZE_BYTES,
          uploadedAt: now.toISOString(),
          startsAt: contractStartsAt,
          endsAt: contractEndsAt,
        }
      : null

    onCreate({
      id: `tea_local_${email.trim().toLowerCase().replace(/[^a-z0-9]/g, '_')}`,
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      nationalIdType,
      nationalId: nationalId.trim(),
      email: email.trim(),
      phone: phone.trim(),
      status: 'active',
      languages: languages.filter((item) => languageIds.includes(item.id)),
      nationality,
      country,
      region,
      city: city.trim(),
      addressLine: addressLine.trim(),
      contract,
      contractDaysLeft: contract ? daysUntil(contract.endsAt, now) : null,
      // Everything countable comes from the class groups, and a teacher created
      // a second ago runs none.
      activeClassGroups: 0,
      studentCount: 0,
      pendingGrades: 0,
      pendingCertificates: 0,
      joinedAt: now.toISOString().slice(0, 10),
    })
  }

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
          </Labelled>

          <Labelled label={t('teachers.field_phone')} required>
            <PhoneField value={phone} onChange={setPhone} required />
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
          </fieldset>
        </div>
      </Block>

      {/* Contract */}
      <Block title={t('teachers.section_contract')} hint={t('teachers.contract_hint')}>
        <AutoGrid min="15rem" gap="gap-3">
          <Labelled label={t('teachers.field_contract_file')} optional={!contractStarted}>
            {/* A name, not a picker: the upload goes straight to the bucket
                through a signed URL once storage is wired (CLAUDE.md §5), and
                until then a file input would promise something that does not
                happen. */}
            <input
              value={contractFileName}
              onChange={(event) => setContractFileName(event.target.value)}
              placeholder={t('teachers.contract_file_placeholder')}
              className={fieldClass}
            />
          </Labelled>

          <Labelled
            label={t('teachers.field_contract_starts')}
            optional={!contractStarted}
          >
            <input
              type="date"
              value={contractStartsAt}
              onChange={(event) => setContractStartsAt(event.target.value)}
              className={fieldClass}
            />
          </Labelled>

          <Labelled label={t('teachers.field_contract_ends')} optional={!contractStarted}>
            <input
              type="date"
              value={contractEndsAt}
              onChange={(event) => setContractEndsAt(event.target.value)}
              className={fieldClass}
            />
          </Labelled>
        </AutoGrid>

        <p className="mt-3 flex items-start gap-2 rounded-lg border border-dashed border-line bg-sky-soft px-3 py-2 text-xs text-muted-foreground">
          <BoIcon name="clock" size={14} className="mt-0.5 shrink-0" />
          {t('teachers.contract_alert_hint', { days: CONTRACT_ALERT_DAYS })}
        </p>

        {contractStarted && !contractComplete && (
          <p className="mt-2 text-xs font-semibold text-red-600">
            {t('teachers.contract_incomplete')}
          </p>
        )}
        {contractComplete && !contractDatesOrdered && (
          <p className="mt-2 text-xs font-semibold text-red-600">
            {t('teachers.contract_dates_out_of_order')}
          </p>
        )}
      </Block>

      <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-line pt-4">
        <button
          type="button"
          disabled={!ready}
          onClick={submit}
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
