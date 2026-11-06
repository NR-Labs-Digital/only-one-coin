'use client'

import { useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import type {
  CheckoutDraft,
  GuardianRelationship,
  NationalIdType,
  PublicCatalog,
} from '@/lib/enrollment/types'
import {
  courseById,
  hasErrors,
  isMinor,
  validateGuardian,
  validateStudent,
} from '@/lib/enrollment/checkout'
import {
  Card,
  FieldGroup,
  GhostButton,
  Note,
  PrimaryButton,
  StepNav,
  SelectInput,
  StepHeading,
  TextInput,
} from '@/components/enrollment/ui'
import { CheckoutIcon } from '@/components/enrollment/icons'
import { citiesOf, PERU_REGIONS } from '@/lib/geo'
import { PhoneField } from '@/components/enrollment/phone-field'
import { BirthDateField } from '@/components/enrollment/birth-date-field'
import { AutoGrid, fullRowClass } from '@/components/layout/auto-grid'
import { GMAIL_SUFFIX, gmailFromUsername, gmailUsernameOf } from '@/lib/enrollment/gmail'
import { EmailSuggestion } from './email-suggestion'

const ID_TYPES: NationalIdType[] = ['DNI', 'CE', 'passport']
const RELATIONSHIPS: GuardianRelationship[] = ['mother', 'father', 'legal_guardian']

/**
 * Step 2 — who is going to study.
 *
 * The student half mirrors the columns the Asociación already collects
 * (`docs/MATRICULA-CHECKOUT.md` §2): one full-name field, document, mobile,
 * birth date, Gmail address.
 *
 * Three things this screen is opinionated about.
 *
 * **The address must be a personal Gmail.** Not advice — a gate. Class access
 * arrives through Google Classroom, and the current form refuses institutional
 * and corporate addresses in capitals. A colegio address that stops working in
 * December is a student who loses the course they paid for. The reader types
 * only the username; `@gmail.com` is fixed beside the field (OOC-141). No code
 * proves the address any more — leaving the page to fetch it lost sales, and
 * the owner accepted the risk of a wrong contact (decision of 06/11/2026).
 *
 * **A minor is the normal case.** Much of the public is under 18
 * (`CLAUDE.md` §1), so the guardian block is not an edge case bolted on — it
 * opens from the birth date and carries the consent record Ley 29733 asks for
 * (`CLAUDE.md` §8). The version, instant and IP are stamped server-side at
 * submit; the browser only records that the box was ticked.
 *
 * **Minimum age is a wall, not a warning.** A course with a floor of 13 does
 * not take a ten-year-old and sort it out in review.
 *
 * Validation runs here AND again in `apps/api`. This half is courtesy — the
 * half that counts is the one the browser cannot skip.
 */
export function StepStudent({
  catalog,
  draft,
  setDraft,
  onBack,
  onContinue,
}: {
  catalog: PublicCatalog
  draft: CheckoutDraft
  setDraft: (next: (prev: CheckoutDraft) => CheckoutDraft) => void
  onBack: () => void
  onContinue: () => void
}) {
  const t = useTranslations('enrollment')
  const [touched, setTouched] = useState(false)
  /** Fields the reader has already left, as `student.email` / `guardian.phone`. */
  const [left, setLeft] = useState<ReadonlySet<string>>(() => new Set())

  const course = courseById(catalog, draft.course.courseId)
  const minor = isMinor(draft.student.birthDate)
  const cities = citiesOf(draft.student.region)

  const studentErrors = useMemo(
    () => validateStudent(draft.student, course),
    [draft.student, course],
  )
  const guardianErrors = useMemo(
    () => (minor ? validateGuardian(draft.guardian) : {}),
    [minor, draft.guardian],
  )

  const ready = !hasErrors(studentErrors) && !hasErrors(guardianErrors)
  /** A field's error shows once the reader leaves it, or once they try to
      move on — never while they are still typing the first letter of it. */
  const leave = (key: string) => () =>
    setLeft((prev) => (prev.has(key) ? prev : new Set(prev).add(key)))

  function patchStudent(patch: Partial<CheckoutDraft['student']>) {
    setDraft((prev) => ({ ...prev, student: { ...prev.student, ...patch } }))
  }

  function patchGuardian(patch: Partial<CheckoutDraft['guardian']>) {
    setDraft((prev) => ({ ...prev, guardian: { ...prev.guardian, ...patch } }))
  }

  function submit() {
    setTouched(true)
    if (ready) onContinue()
  }

  const show = touched
  const errFor = (scope: 'student' | 'guardian') => (field: string, key: string | undefined) =>
    (touched || left.has(`${scope}.${field}`)) && key ? t(`error.${key}`) : undefined
  const sErr = errFor('student')
  const gErr = errFor('guardian')
  const consentError = gErr('consentAccepted', guardianErrors.consentAccepted)

  return (
    <div className="flex flex-col gap-5">
      <StepHeading
        title={t('step.student.title')}
        subtitle={t('step.student.subtitle')}
      />

      <Card className="p-5">
        <AutoGrid min="15rem" gap="gap-4">
          <FieldGroup
            label={t('field.first_name')}
            htmlFor="first-name"
            onLeave={leave('student.firstName')}
            error={sErr('firstName', studentErrors.firstName)}
          >
            <TextInput
              id="first-name"
              autoComplete="given-name"
              value={draft.student.firstName}
              invalid={Boolean(sErr('firstName', studentErrors.firstName))}
              onChange={(e) => patchStudent({ firstName: e.target.value })}
            />
          </FieldGroup>

          <FieldGroup
            label={t('field.last_name')}
            htmlFor="last-name"
            onLeave={leave('student.lastName')}
            error={sErr('lastName', studentErrors.lastName)}
            hint={t('step.student.full_name_hint')}
          >
            <TextInput
              id="last-name"
              autoComplete="family-name"
              value={draft.student.lastName}
              invalid={Boolean(sErr('lastName', studentErrors.lastName))}
              onChange={(e) => patchStudent({ lastName: e.target.value })}
            />
          </FieldGroup>

          <FieldGroup label={t('field.national_id_type')} htmlFor="id-type">
            <SelectInput
              id="id-type"
              value={draft.student.nationalIdType}
              onChange={(e) =>
                patchStudent({ nationalIdType: e.target.value as NationalIdType })
              }
            >
              {ID_TYPES.map((type) => (
                <option key={type} value={type}>
                  {t(`national_id_type.${type}`)}
                </option>
              ))}
            </SelectInput>
          </FieldGroup>

          <FieldGroup
            label={t('field.national_id')}
            htmlFor="national-id"
            onLeave={leave('student.nationalId')}
            error={sErr('nationalId', studentErrors.nationalId)}
          >
            <TextInput
              id="national-id"
              inputMode="numeric"
              value={draft.student.nationalId}
              invalid={Boolean(sErr('nationalId', studentErrors.nationalId))}
              onChange={(e) => patchStudent({ nationalId: e.target.value })}
            />
          </FieldGroup>

          <FieldGroup
            label={t('field.phone')}
            htmlFor="phone"
            onLeave={leave('student.phone')}
            error={sErr('phone', studentErrors.phone)}
            hint={t('step.student.phone_hint')}
          >
            <PhoneField
              id="phone"
              value={draft.student.phone}
              invalid={Boolean(sErr('phone', studentErrors.phone))}
              onChange={(phone) => patchStudent({ phone })}
            />
          </FieldGroup>

          <FieldGroup
            label={t('field.birth_date')}
            htmlFor="birth-date"
            onLeave={leave('student.birthDate')}
            error={sErr('birthDate', studentErrors.birthDate) ?? sErr('birthDate', studentErrors.minAge)}
            hint={
              course ? t('step.student.min_age_hint', { age: course.minAge }) : undefined
            }
          >
            <BirthDateField
              id="birth-date"
              value={draft.student.birthDate}
              invalid={Boolean(
                sErr('birthDate', studentErrors.birthDate) ?? sErr('birthDate', studentErrors.minAge),
              )}
              onChange={(birthDate) => patchStudent({ birthDate })}
            />
          </FieldGroup>

          <FieldGroup
            label={t('field.email')}
            htmlFor="email"
            onLeave={leave('student.email')}
            error={sErr('email', studentErrors.email)}
            hint={t('step.student.email_hint')}
          >
            <span className="flex gap-2">
              <TextInput
                id="email"
                inputMode="email"
                autoComplete="email"
                autoCapitalize="none"
                spellCheck={false}
                aria-describedby="email-suffix"
                className="min-w-0 flex-1"
                value={gmailUsernameOf(draft.student.email)}
                invalid={Boolean(sErr('email', studentErrors.email))}
                onChange={(e) => patchStudent({ email: gmailFromUsername(e.target.value) })}
              />
              <span
                id="email-suffix"
                className="flex shrink-0 items-center rounded-lg border border-line bg-sky-soft px-3 text-sm font-medium text-ink"
              >
                {GMAIL_SUFFIX}
              </span>
            </span>
          </FieldGroup>

          {/* One pair, always in its own row: region decides what city offers,
              and the two read as one address line — an outer auto-fit column
              could otherwise land them apart on a width neither expects. */}
          <div className={fullRowClass}>
            <AutoGrid min="10rem" gap="gap-4">
              <FieldGroup
                label={t('field.region')}
                htmlFor="region"
                onLeave={leave('student.region')}
                error={sErr('region', studentErrors.region)}
              >
                <SelectInput
                  id="region"
                  value={draft.student.region ?? ''}
                  invalid={Boolean(sErr('region', studentErrors.region))}
                  onChange={(e) =>
                    patchStudent({ region: e.target.value || null, city: '' })
                  }
                >
                  <option value="">{t('field.region_placeholder')}</option>
                  {PERU_REGIONS.map((r) => (
                    <option key={r.region} value={r.region}>
                      {r.region}
                    </option>
                  ))}
                </SelectInput>
              </FieldGroup>

              <FieldGroup
                label={t('field.city')}
                htmlFor="city"
                onLeave={leave('student.city')}
                error={sErr('city', studentErrors.city)}
              >
                <SelectInput
                  id="city"
                  value={draft.student.city}
                  invalid={Boolean(sErr('city', studentErrors.city))}
                  disabled={cities.length === 0}
                  onChange={(e) => patchStudent({ city: e.target.value })}
                >
                  <option value="">
                    {cities.length === 0
                      ? t('field.city_needs_region')
                      : t('field.region_placeholder')}
                  </option>
                  {cities.map((city) => (
                    <option key={city} value={city}>
                      {city}
                    </option>
                  ))}
                </SelectInput>
              </FieldGroup>
            </AutoGrid>
          </div>
        </AutoGrid>
      </Card>

      {minor && (
        <Card className="p-5">
          <p className="mb-1 flex items-center gap-2 text-sm font-semibold text-ink">
            <CheckoutIcon name="user" size={16} className="text-brand-blue" />
            {t('step.student.guardian_title')}
          </p>
          <p className="mb-4 text-xs text-muted-foreground">
            {t('step.student.guardian_subtitle')}
          </p>

          <AutoGrid min="15rem" gap="gap-4">
            <FieldGroup
              label={t('field.first_name')}
              htmlFor="guardian-first-name"
              onLeave={leave('guardian.firstName')}
              error={gErr('firstName', guardianErrors.firstName)}
            >
              <TextInput
                id="guardian-first-name"
                autoComplete="given-name"
                value={draft.guardian.firstName}
                invalid={Boolean(gErr('firstName', guardianErrors.firstName))}
                onChange={(e) => patchGuardian({ firstName: e.target.value })}
              />
            </FieldGroup>

            <FieldGroup
              label={t('field.last_name')}
              htmlFor="guardian-last-name"
              onLeave={leave('guardian.lastName')}
              error={gErr('lastName', guardianErrors.lastName)}
            >
              <TextInput
                id="guardian-last-name"
                autoComplete="family-name"
                value={draft.guardian.lastName}
                invalid={Boolean(gErr('lastName', guardianErrors.lastName))}
                onChange={(e) => patchGuardian({ lastName: e.target.value })}
              />
            </FieldGroup>

            <FieldGroup label={t('field.relationship')} htmlFor="relationship">
              <SelectInput
                id="relationship"
                value={draft.guardian.relationship}
                onChange={(e) =>
                  patchGuardian({
                    relationship: e.target.value as GuardianRelationship,
                  })
                }
              >
                {RELATIONSHIPS.map((value) => (
                  <option key={value} value={value}>
                    {t(`relationship.${value}`)}
                  </option>
                ))}
              </SelectInput>
            </FieldGroup>

            <FieldGroup label={t('field.national_id_type')} htmlFor="guardian-id-type">
              <SelectInput
                id="guardian-id-type"
                value={draft.guardian.nationalIdType}
                onChange={(e) =>
                  patchGuardian({ nationalIdType: e.target.value as NationalIdType })
                }
              >
                {ID_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {t(`national_id_type.${type}`)}
                  </option>
                ))}
              </SelectInput>
            </FieldGroup>

            <FieldGroup
              label={t('field.national_id')}
              htmlFor="guardian-national-id"
              onLeave={leave('guardian.nationalId')}
              error={gErr('nationalId', guardianErrors.nationalId)}
            >
              <TextInput
                id="guardian-national-id"
                inputMode="numeric"
                value={draft.guardian.nationalId}
                invalid={Boolean(gErr('nationalId', guardianErrors.nationalId))}
                onChange={(e) => patchGuardian({ nationalId: e.target.value })}
              />
            </FieldGroup>

            <FieldGroup
              label={t('field.phone')}
              htmlFor="guardian-phone"
              onLeave={leave('guardian.phone')}
              error={gErr('phone', guardianErrors.phone)}
            >
              <PhoneField
                id="guardian-phone"
                value={draft.guardian.phone}
                invalid={Boolean(gErr('phone', guardianErrors.phone))}
                onChange={(phone) => patchGuardian({ phone })}
              />
            </FieldGroup>

            {/* No Gmail rule on this one: Classroom belongs to the student.
                This address is where the Asociación reaches a responsible
                adult, and forcing a provider on it only loses that contact. */}
            <FieldGroup
              label={t('field.email')}
              htmlFor="guardian-email"
              onLeave={leave('guardian.email')}
              error={gErr('email', guardianErrors.email)}
              hint={t('step.student.guardian_email_hint')}
            >
              <TextInput
                id="guardian-email"
                type="email"
                value={draft.guardian.email}
                invalid={Boolean(gErr('email', guardianErrors.email))}
                onChange={(e) => patchGuardian({ email: e.target.value })}
              />
              <EmailSuggestion email={draft.guardian.email} onApply={(email) => patchGuardian({ email })} />
            </FieldGroup>

            {/* Typed twice, never pasted: nobody proves this address with a
                code, so a typo here is a guardian the Asociación cannot reach. */}
            <FieldGroup
              label={t('step.student.guardian_email_confirm')}
              htmlFor="guardian-email-confirm"
              onLeave={leave('guardian.emailConfirmation')}
              error={gErr('emailConfirmation', guardianErrors.emailConfirmation)}
            >
              <TextInput
                id="guardian-email-confirm"
                type="email"
                autoComplete="off"
                onPaste={(e) => e.preventDefault()}
                value={draft.guardian.emailConfirmation}
                invalid={Boolean(gErr('emailConfirmation', guardianErrors.emailConfirmation))}
                onChange={(e) => patchGuardian({ emailConfirmation: e.target.value })}
              />
            </FieldGroup>

            <div className={fullRowClass}>
              <label className="flex items-start gap-3 rounded-xl border border-line bg-sky-soft p-4">
                <input
                  type="checkbox"
                  checked={draft.guardian.consentAccepted}
                  onChange={(e) =>
                    patchGuardian({ consentAccepted: e.target.checked })
                  }
                  className="mt-0.5 h-4 w-4 shrink-0 rounded border-line text-brand-blue focus:ring-brand-blue"
                />
                <span className="min-w-0 text-sm text-ink">
                  {t('step.student.consent_label')}
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {t('step.student.consent_version', {
                      version: catalog.settings.consentVersion,
                    })}
                  </span>
                </span>
              </label>
              {consentError && (
                <p className="mt-1.5 flex items-center gap-1.5 text-xs font-medium text-red-600">
                  <CheckoutIcon name="alert" size={14} />
                  {consentError}
                </p>
              )}
            </div>
          </AutoGrid>
        </Card>
      )}

      {show && !ready && <Note tone="danger">{t('error.fix_fields')}</Note>}

      <StepNav
        back={
          <GhostButton onClick={onBack}>
            <CheckoutIcon name="arrow-left" size={16} />
            {t('action.back')}
          </GhostButton>
        }
      >
        <PrimaryButton onClick={submit}>
          {t('action.continue')}
          <CheckoutIcon name="arrow-right" size={16} />
        </PrimaryButton>
      </StepNav>
    </div>
  )
}
