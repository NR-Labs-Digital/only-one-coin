'use client'

import { useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import type { AvailabilitySlot, NationalIdType } from '@/lib/backoffice/types'
import {
  COUNTRIES,
  countryName,
  DEFAULT_COUNTRY,
  PERU_REGIONS,
  citiesOf,
  flagEmoji,
} from '@/lib/geo'
import { Card, Field, RequiredMark } from '@/components/backoffice/ui'
import { hasPhoneNumber, PhoneField } from '@/components/backoffice/phone-field'
import { BoIcon } from '@/components/backoffice/icons'
import { AvailabilityFields, slotsAreValid } from '@/components/backoffice/teachers/availability-fields'
import { AutoGrid } from '@/components/layout/auto-grid'
import { FieldMessage } from '@/components/backoffice/field-message'
import { saveTeacher, type TeacherSaveFailure } from '@/lib/backoffice/save-teacher'

const fieldClass =
  'rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink outline-none transition placeholder:text-muted-foreground focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/15'

const labelClass = 'text-xs font-medium uppercase tracking-wide text-muted-foreground'

const ID_TYPES: NationalIdType[] = ['DNI', 'CE', 'passport']

/**
 * The teacher's onboarding (OOC-103): the first screen of the docente portal
 * for a file coordination registered with name, e-mail and languages only. The
 * teacher fills in the rest — document, phone, origin, address and the week
 * they are free — once. From then on the file is read-only to them and
 * coordination corrects it, as before (CLAUDE.md §1, OOC-79).
 *
 * Name, e-mail and languages are shown, not edited: the e-mail is the
 * account's and the languages are a clearance. The address of the write has
 * no id — the API resolves the file from the session (anti-IDOR, §8).
 */
export function TeacherOnboardingForm({
  firstName,
  lastName,
  email,
  languages,
}: {
  firstName: string
  lastName: string
  email: string
  languages: string[]
}) {
  const t = useTranslations('bo')
  const locale = useLocale()
  const router = useRouter()

  const [nationalIdType, setNationalIdType] = useState<NationalIdType>('DNI')
  const [nationalId, setNationalId] = useState('')
  const [phone, setPhone] = useState('')
  const [nationality, setNationality] = useState(DEFAULT_COUNTRY)
  const [country, setCountry] = useState(DEFAULT_COUNTRY)
  const [region, setRegion] = useState<string | null>(null)
  const [city, setCity] = useState('')
  const [addressLine, setAddressLine] = useState('')
  const [availability, setAvailability] = useState<AvailabilitySlot[]>([])
  const [pending, setPending] = useState(false)
  const [failure, setFailure] = useState<TeacherSaveFailure | null>(null)

  const inPeru = country === DEFAULT_COUNTRY
  const cities = citiesOf(region)

  const ready =
    nationalId.trim() !== '' &&
    hasPhoneNumber(phone) &&
    addressLine.trim() !== '' &&
    (!inPeru || region !== null) &&
    city.trim() !== '' &&
    availability.length > 0 &&
    slotsAreValid(availability)

  const fieldError = (key: string) => (failure?.kind === 'invalid' ? failure.fields[key] : undefined)

  function selectCountry(next: string) {
    setCountry(next)
    setRegion(null)
    setCity('')
  }

  async function submit() {
    if (!ready || pending) return
    setPending(true)
    setFailure(null)
    const result = await saveTeacher<{ id: string }>('/api/v1/teaching/onboarding', 'PUT', {
      nationalIdType,
      nationalId: nationalId.trim(),
      phone,
      nationality,
      country,
      region,
      city: city.trim(),
      addressLine: addressLine.trim(),
      availability,
    })
    setPending(false)
    if (!result.ok) {
      setFailure(result.failure)
      return
    }
    // The shell reads `/me` again and opens the portal's screens.
    router.refresh()
  }

  const failureMessage =
    failure === null
      ? null
      : failure.kind === 'duplicate'
        ? t('teacher_onboarding.error_duplicate')
        : failure.kind === 'invalid'
          ? t('new_student.invalid_error')
          : t('teachers.save_error_generic')

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink">{t('teacher_onboarding.title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('teacher_onboarding.subtitle')}</p>
      </div>

      {/* What coordination registered — read, not edited here. */}
      <Card className="p-5">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t('teacher_onboarding.registered_title')}
        </p>
        <AutoGrid as="dl" min="14rem">
          <Field label={t('teacher_onboarding.field_name')}>{`${firstName} ${lastName}`}</Field>
          <Field label={t('teachers.field_email')}>{email}</Field>
          <Field label={t('teachers.field_languages')}>{languages.join(' · ')}</Field>
        </AutoGrid>
        <p className="mt-3 text-xs text-muted-foreground">{t('teacher_onboarding.registered_hint')}</p>
      </Card>

      <Card className="p-5">
        <Block title={t('teachers.section_identity')} first>
          <AutoGrid min="14rem" gap="gap-3">
            <Labelled label={t('teachers.field_id_type')}>
              <select
                value={nationalIdType}
                onChange={(event) => setNationalIdType(event.target.value as NationalIdType)}
                className={fieldClass}
              >
                {ID_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {t(`national_id_type.${type}`)}
                  </option>
                ))}
              </select>
            </Labelled>

            <Labelled label={t('teachers.field_id_number')}>
              <input
                value={nationalId}
                onChange={(event) => setNationalId(event.target.value)}
                className={`${fieldClass} tabular-nums`}
              />
              <FieldMessage code={fieldError('nationalId')} />
            </Labelled>

            <Labelled label={t('teachers.field_nationality')}>
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

            <Labelled label={t('teachers.field_phone')}>
              <PhoneField value={phone} onChange={setPhone} required />
              <FieldMessage code={fieldError('phone')} />
            </Labelled>
          </AutoGrid>
        </Block>

        <Block title={t('teachers.section_address')} hint={t('teacher_onboarding.address_hint')}>
          <AutoGrid min="14rem" gap="gap-3">
            <Labelled label={t('teachers.field_country')}>
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
              <Labelled label={t('teachers.field_region')}>
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

            <Labelled label={t('teachers.field_city')}>
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
                <input value={city} onChange={(event) => setCity(event.target.value)} className={fieldClass} />
              )}
            </Labelled>

            <Labelled label={t('teachers.field_address_line')}>
              <input
                value={addressLine}
                onChange={(event) => setAddressLine(event.target.value)}
                placeholder={t('teachers.address_line_placeholder')}
                className={fieldClass}
              />
            </Labelled>
          </AutoGrid>
        </Block>

        <Block title={t('availability.title')} hint={t('teacher_onboarding.availability_hint')}>
          <AvailabilityFields value={availability} onChange={setAvailability} />
          <FieldMessage code={fieldError('availability')} />
        </Block>

        <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-line pt-4">
          <button
            type="button"
            disabled={!ready || pending}
            onClick={() => void submit()}
            className="inline-flex min-h-tap items-center gap-1.5 rounded-lg bg-brand-blue px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-brand-blue-deep disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-brand-blue"
          >
            <BoIcon name="check" size={16} />
            {t('teacher_onboarding.submit')}
          </button>
          {!ready && <span className="text-xs text-muted-foreground">{t('teachers.missing_fields')}</span>}
          {failureMessage && (
            <span role="alert" className="text-xs font-semibold text-red-600">
              {failureMessage}
            </span>
          )}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">{t('teacher_onboarding.once_hint')}</p>
      </Card>
    </div>
  )
}

/** One question per block, with a rule above it — the new-teacher form's layout. */
function Block({
  title,
  hint,
  first,
  children,
}: {
  title: string
  hint?: string
  first?: boolean
  children: React.ReactNode
}) {
  return (
    <section className={first ? '' : 'mt-5 border-t border-line pt-4'}>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      <div className="mt-3">{children}</div>
    </section>
  )
}

function Labelled({ label, children }: { label: string; children: React.ReactNode }) {
  const t = useTranslations('bo')
  return (
    <label className="flex flex-col gap-1">
      <span className={labelClass}>
        {label}
        <RequiredMark label={t('common.required')} />
      </span>
      {children}
    </label>
  )
}
