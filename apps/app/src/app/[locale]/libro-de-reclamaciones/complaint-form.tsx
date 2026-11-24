'use client'

import { useRef, useState, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import {
  ComplaintFormSchema,
  parseSolesToCents,
  toFieldErrors,
  type ComplaintGoodType,
  type ComplaintKind,
  type FieldErrorCode,
  type NationalIdType,
} from '@ooc/domain/fields'
import { Card, ChoiceCard, FieldGroup, Note, PrimaryButton, SelectInput, TextInput } from '@/components/enrollment/ui'
import { Turnstile } from '@/components/enrollment/turnstile'
import { AutoGrid, fullRowClass } from '@/components/layout/auto-grid'
import { parseFieldErrors } from '@/lib/field-errors'
import { formatDate, type Locale } from '@/lib/format'

const ID_TYPES: NationalIdType[] = ['DNI', 'CE', 'passport']
const KINDS: ComplaintKind[] = ['claim', 'grievance']
const GOOD_TYPES: ComplaintGoodType[] = ['product', 'service']

const apiLocale: Record<Locale, 'es-PE' | 'en' | 'pt-BR'> = { es: 'es-PE', en: 'en', pt: 'pt-BR' }

interface Draft {
  kind: ComplaintKind | null
  firstName: string
  lastName: string
  secondLastName: string
  nationalIdType: NationalIdType
  nationalId: string
  phone: string
  email: string
  department: string
  province: string
  district: string
  address: string
  addressReference: string
  isMinor: boolean | null
  guardianFirstName: string
  guardianLastName: string
  guardianNationalIdType: NationalIdType
  guardianNationalId: string
  goodType: ComplaintGoodType | null
  amount: string
  purchasedOn: string
  description: string
  detail: string
  request: string
  truthfulnessAccepted: boolean
  privacyAccepted: boolean
}

const emptyDraft: Draft = {
  kind: null,
  firstName: '',
  lastName: '',
  secondLastName: '',
  nationalIdType: 'DNI',
  nationalId: '',
  phone: '',
  email: '',
  department: '',
  province: '',
  district: '',
  address: '',
  addressReference: '',
  isMinor: null,
  guardianFirstName: '',
  guardianLastName: '',
  guardianNationalIdType: 'DNI',
  guardianNationalId: '',
  goodType: null,
  amount: '',
  purchasedOn: '',
  description: '',
  detail: '',
  request: '',
  truthfulnessAccepted: false,
  privacyAccepted: false,
}

/** The draft's free-text fields, and where each one sits in the request body. */
type TextKey = Exclude<keyof Draft, 'kind' | 'nationalIdType' | 'isMinor' | 'guardianNationalIdType' | 'goodType' | 'amount' | 'truthfulnessAccepted' | 'privacyAccepted'>

const FIELD_PATHS: Record<TextKey, string> = {
  firstName: 'consumer.firstName',
  lastName: 'consumer.lastName',
  secondLastName: 'consumer.secondLastName',
  nationalId: 'consumer.nationalId',
  phone: 'consumer.phone',
  email: 'consumer.email',
  department: 'consumer.department',
  province: 'consumer.province',
  district: 'consumer.district',
  address: 'consumer.address',
  addressReference: 'consumer.addressReference',
  guardianFirstName: 'guardian.firstName',
  guardianLastName: 'guardian.lastName',
  guardianNationalId: 'guardian.nationalId',
  purchasedOn: 'purchasedOn',
  description: 'description',
  detail: 'detail',
  request: 'request',
}

/** A field's error: a code the locale knows, or the two this form adds. */
type FieldIssue = FieldErrorCode | 'amount' | 'accept'

/** The body `ComplaintFormSchema` reads, built from what was typed. */
function bodyOf(draft: Draft, amountCents: number | null) {
  return {
    kind: draft.kind,
    consumer: {
      firstName: draft.firstName,
      lastName: draft.lastName,
      secondLastName: draft.secondLastName,
      nationalIdType: draft.nationalIdType,
      nationalId: draft.nationalId,
      phone: draft.phone,
      email: draft.email,
      department: draft.department,
      province: draft.province,
      district: draft.district,
      address: draft.address,
      addressReference: draft.addressReference,
      isMinor: draft.isMinor,
    },
    guardian: draft.isMinor
      ? {
          firstName: draft.guardianFirstName,
          lastName: draft.guardianLastName,
          nationalIdType: draft.guardianNationalIdType,
          nationalId: draft.guardianNationalId,
        }
      : null,
    goodType: draft.goodType,
    amountCents,
    purchasedOn: draft.purchasedOn === '' ? null : draft.purchasedOn,
    description: draft.description,
    detail: draft.detail,
    request: draft.request,
    truthfulnessAccepted: draft.truthfulnessAccepted,
    privacyAccepted: draft.privacyAccepted,
  }
}

/** Choices nobody picked yet are null, which the schema calls `invalid`. */
const CHOICE_PATHS = new Set(['kind', 'goodType', 'consumer.isMinor'])

/** The checkboxes answer "accept", an unpicked choice "required". */
function issueFor(path: string, code: FieldErrorCode): FieldIssue {
  if (path === 'truthfulnessAccepted' || path === 'privacyAccepted') return 'accept'
  if (CHOICE_PATHS.has(path)) return 'required'
  return code
}

type Failure = 'fix_fields' | 'rate_limited' | 'captcha' | 'captcha_unavailable' | 'captcha_missing' | 'generic'

interface Filed {
  code: string
  filedAt: string
  email: string
}

/**
 * The sheet itself. Validation runs here with the same schema the API runs
 * (`ComplaintFormSchema`, `@ooc/domain/fields`) — courtesy; the API's is the
 * one that counts. One idempotency key per sheet: a resend after a lost
 * answer gets the same number, never a second sheet.
 */
export function ComplaintForm({
  locale,
  siteKey,
  supplier,
  privacyUrl,
  siteUrl,
}: {
  locale: Locale
  siteKey: string
  supplier: { legalName: string; ruc: string; address: string }
  privacyUrl: string
  siteUrl: string
}) {
  const t = useTranslations('complaints')
  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const [errors, setErrors] = useState<Record<string, FieldIssue>>({})
  const [failure, setFailure] = useState<Failure | null>(null)
  const [sending, setSending] = useState(false)
  const [filed, setFiled] = useState<Filed | null>(null)
  const [captchaToken, setCaptchaToken] = useState<string | null>(null)
  const [captchaDown, setCaptchaDown] = useState(false)
  const [captchaReset, setCaptchaReset] = useState(0)
  const idempotencyKey = useRef<string | null>(null)

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((current) => ({ ...current, [key]: value }))
  const errorOf = (path: string) => {
    const issue = errors[path]
    return issue ? t(`errors.${issue}`) : undefined
  }

  async function submit() {
    setFailure(null)
    const amount = parseSolesToCents(draft.amount)
    const body = bodyOf(draft, amount === 'invalid' ? null : amount)

    const found: Record<string, FieldIssue> = {}
    if (amount === 'invalid') found.amountCents = 'amount'
    const parsed = ComplaintFormSchema.safeParse(body)
    if (!parsed.success) {
      for (const { path, code } of toFieldErrors(parsed.error.issues)) found[path] ??= issueFor(path, code)
    }
    setErrors(found)
    if (Object.keys(found).length > 0) return setFailure('fix_fields')
    if (!captchaToken) return setFailure(captchaDown ? 'captcha_unavailable' : 'captcha_missing')

    idempotencyKey.current ??= crypto.randomUUID()
    setSending(true)
    try {
      const response = await fetch('/api/v1/public/complaints', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          captchaToken,
          idempotencyKey: idempotencyKey.current,
          locale: apiLocale[locale],
          complaint: body,
        }),
      })
      if (response.ok) {
        const result = (await response.json()) as { code: string; filedAt: string }
        setFiled({ ...result, email: parsed.success ? parsed.data.consumer.email : draft.email })
        window.scrollTo({ top: 0 })
        return
      }
      // Every answer that reached the server spent the token.
      setCaptchaReset((n) => n + 1)
      if (response.status === 429) return setFailure('rate_limited')
      if (response.status === 503) return setFailure('captcha_unavailable')
      const payload: unknown = await response.json().catch(() => null)
      if (response.status === 400) {
        const fields = parseFieldErrors(payload)
        if (fields.length > 0) {
          setErrors(
            Object.fromEntries(
              fields.map(({ path, code }) => {
                const own = path.replace(/^complaint\./, '')
                return [own, issueFor(own, code)]
              }),
            ),
          )
          return setFailure('fix_fields')
        }
      }
      if ((payload as { reason?: string } | null)?.reason === 'captcha.failed') return setFailure('captcha')
      setFailure('generic')
    } catch {
      setCaptchaReset((n) => n + 1)
      setFailure('generic')
    } finally {
      setSending(false)
    }
  }

  if (filed) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 sm:py-10">
        <Card className="p-6 sm:p-8">
          <h1 className="text-2xl font-semibold text-ink sm:text-3xl">{t('done.title')}</h1>
          <p className="mt-5 text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('done.number')}</p>
          <p className="mt-1 font-mono text-3xl font-semibold tracking-wider text-brand-blue">{filed.code}</p>
          <p className="mt-3 text-sm text-muted-foreground">{t('done.filed_at', { date: formatDate(filed.filedAt, locale) })}</p>
          <div className="mt-5">
            <Note tone="success">{t('done.email_sent', { email: filed.email })}</Note>
          </div>
          <div className="mt-6">
            <PrimaryButton href={siteUrl}>{t('done.back')}</PrimaryButton>
          </div>
        </Card>
      </div>
    )
  }

  const idTypeOptions = ID_TYPES.map((type) => (
    <option key={type} value={type}>
      {t(`id_type.${type}`)}
    </option>
  ))

  /** What a field reads and writes, by its key in the draft. */
  const bind = (key: TextKey) => {
    const path = FIELD_PATHS[key]
    return {
      id: path,
      value: draft[key],
      onChange: (value: string) => set(key, value),
      error: errorOf(path),
      optionalHint: t('optional'),
    }
  }

  const check = (key: 'truthfulnessAccepted' | 'privacyAccepted', label: ReactNode) => (
    <div className="flex flex-col gap-1">
      <label className="flex items-start gap-3 text-sm text-ink">
        <input
          type="checkbox"
          checked={draft[key]}
          onChange={(event) => set(key, event.target.checked)}
          aria-invalid={Boolean(errors[key]) || undefined}
          className="mt-0.5 size-4 shrink-0 accent-[var(--color-brand-blue)]"
        />
        <span>{label}</span>
      </label>
      {errors[key] && <p className="pl-7 text-xs font-medium text-red-600">{t(`errors.${errors[key]}`)}</p>}
    </div>
  )

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-8 sm:px-6 sm:py-10">
      <header>
        <h1 className="text-2xl font-semibold leading-tight text-ink sm:text-3xl">{t('title')}</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">{t('subtitle')}</p>
      </header>

      <Section title={t('supplier.title')}>
        <dl className="grid gap-3 text-sm sm:grid-cols-[auto_1fr] sm:gap-x-6">
          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('supplier.legal_name')}</dt>
          <dd className="font-semibold text-ink">{supplier.legalName}</dd>
          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('supplier.ruc')}</dt>
          <dd className="text-ink">{supplier.ruc}</dd>
          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('supplier.address')}</dt>
          <dd className="text-ink">{supplier.address}</dd>
        </dl>
      </Section>

      <Section title={t('consumer.title')}>
        <AutoGrid min="14rem">
          <TextField {...bind('firstName')} label={t('consumer.first_name')} autoComplete="given-name" />
          <TextField {...bind('lastName')} label={t('consumer.last_name')} autoComplete="family-name" />
          <TextField {...bind('secondLastName')} label={t('consumer.second_last_name')} optional />
          <FieldGroup label={t('consumer.id_type')} htmlFor="consumer.nationalIdType">
            <SelectInput
              id="consumer.nationalIdType"
              value={draft.nationalIdType}
              onChange={(event) => set('nationalIdType', event.target.value as NationalIdType)}
            >
              {idTypeOptions}
            </SelectInput>
          </FieldGroup>
          <TextField {...bind('nationalId')} label={t('consumer.national_id')} />
          <TextField {...bind('phone')} label={t('consumer.phone')} type="tel" autoComplete="tel" inputMode="tel" />
          <div className={fullRowClass}>
            <TextField {...bind('email')} label={t('consumer.email')} type="email" autoComplete="email" hint={t('consumer.email_hint')} />
          </div>
          <TextField {...bind('department')} label={t('consumer.department')} />
          <TextField {...bind('province')} label={t('consumer.province')} />
          <TextField {...bind('district')} label={t('consumer.district')} />
          <div className={fullRowClass}><TextField {...bind('address')} label={t('consumer.address')} autoComplete="street-address" /></div>
          <div className={fullRowClass}>
            <TextField {...bind('addressReference')} label={t('consumer.address_reference')} optional />
          </div>
          <div className={fullRowClass}>
            <FieldGroup label={t('consumer.is_minor')} error={errorOf('consumer.isMinor')}>
              <div className="grid grid-cols-2 gap-3">
                <ChoiceCard selected={draft.isMinor === true} onSelect={() => set('isMinor', true)} title={t('consumer.yes')} />
                <ChoiceCard selected={draft.isMinor === false} onSelect={() => set('isMinor', false)} title={t('consumer.no')} />
              </div>
            </FieldGroup>
          </div>
        </AutoGrid>
      </Section>

      {draft.isMinor && (
        <Section title={t('guardian.title')} subtitle={t('guardian.subtitle')}>
          <AutoGrid min="14rem">
            <TextField {...bind('guardianFirstName')} label={t('guardian.first_name')} />
            <TextField {...bind('guardianLastName')} label={t('guardian.last_name')} />
            <FieldGroup label={t('guardian.id_type')} htmlFor="guardian.nationalIdType">
              <SelectInput
                id="guardian.nationalIdType"
                value={draft.guardianNationalIdType}
                onChange={(event) => set('guardianNationalIdType', event.target.value as NationalIdType)}
              >
                {idTypeOptions}
              </SelectInput>
            </FieldGroup>
            <TextField {...bind('guardianNationalId')} label={t('guardian.national_id')} />
          </AutoGrid>
        </Section>
      )}

      <Section title={t('good.title')}>
        <AutoGrid min="14rem">
          <div className={fullRowClass}>
            <FieldGroup label={t('good.good_type')} error={errorOf('goodType')}>
              <div className="grid grid-cols-2 gap-3">
                {GOOD_TYPES.map((type) => (
                  <ChoiceCard key={type} selected={draft.goodType === type} onSelect={() => set('goodType', type)} title={t(`good.${type}`)} />
                ))}
              </div>
            </FieldGroup>
          </div>
          <FieldGroup label={t('good.amount')} htmlFor="amountCents" error={errorOf('amountCents')} hint={t('optional')} optional>
            <TextInput
              id="amountCents"
              value={draft.amount}
              onChange={(event) => set('amount', event.target.value)}
              invalid={Boolean(errors.amountCents)}
              inputMode="decimal"
              placeholder={t('good.amount_placeholder')}
            />
          </FieldGroup>
          <TextField {...bind('purchasedOn')} label={t('good.purchased_on')} type="date" optional />
          <div className={fullRowClass}>
            <TextArea {...bind('description')} label={t('good.description')} rows={2} placeholder={t('good.description_placeholder')} />
          </div>
        </AutoGrid>
      </Section>

      <Section title={t('detail.title')}>
        <div className="flex flex-col gap-4">
          <FieldGroup label={t('detail.kind')} error={errorOf('kind')}>
            <div className="grid gap-3 sm:grid-cols-2">
              {KINDS.map((kind) => (
                <ChoiceCard
                  key={kind}
                  selected={draft.kind === kind}
                  onSelect={() => set('kind', kind)}
                  title={t(`kind.${kind}.title`)}
                  meta={t(`kind.${kind}.description`)}
                />
              ))}
            </div>
          </FieldGroup>
          <TextArea {...bind('detail')} label={t('detail.detail')} hint={t('detail.detail_hint')} />
          <TextArea {...bind('request')} label={t('detail.request')} hint={t('detail.request_hint')} />
        </div>
      </Section>

      <Section title={t('declaration.title')}>
        <div className="flex flex-col gap-4">
          {check('truthfulnessAccepted', t('declaration.truthfulness'))}
          {check(
            'privacyAccepted',
            t.rich('declaration.privacy', {
              link: (chunks) => (
                <a href={privacyUrl} target="_blank" rel="noopener noreferrer" className="font-semibold text-brand-blue underline">
                  {chunks}
                </a>
              ),
            }),
          )}
          <Note tone="info">{t('notice')}</Note>
        </div>
      </Section>

      <div className="flex flex-col gap-4">
        {!captchaDown && (
          <Turnstile
            siteKey={siteKey}
            locale={locale}
            resetKey={captchaReset}
            onToken={setCaptchaToken}
            onUnavailable={() => setCaptchaDown(true)}
          />
        )}
        {failure && (
          <div role="alert">
            <Note tone="danger">{t(`failure.${failure}`)}</Note>
          </div>
        )}
        <div>
          <PrimaryButton type="button" onClick={() => void submit()} disabled={sending}>
            {sending ? t('submitting') : t('submit')}
          </PrimaryButton>
        </div>
      </div>
    </div>
  )
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <Card as="section" className="p-5 sm:p-6">
      <h2 className="text-base font-semibold text-ink">{title}</h2>
      {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
      <div className="mt-4">{children}</div>
    </Card>
  )
}

interface FieldProps {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  error?: string
  hint?: string
  /** The word under an optional field with nothing else to say. */
  optionalHint: string
  optional?: boolean
  placeholder?: string
}

function TextField({
  id,
  label,
  value,
  onChange,
  error,
  hint,
  optionalHint,
  optional = false,
  placeholder,
  type = 'text',
  autoComplete,
  inputMode,
}: FieldProps & { type?: string; autoComplete?: string; inputMode?: 'tel' | 'email' | 'decimal' }) {
  return (
    <FieldGroup label={label} htmlFor={id} error={error} hint={hint ?? (optional ? optionalHint : undefined)} optional={optional}>
      <TextInput
        id={id}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        invalid={Boolean(error)}
        required={!optional}
        placeholder={placeholder}
        autoComplete={autoComplete}
        inputMode={inputMode}
      />
    </FieldGroup>
  )
}

function TextArea({ id, label, value, onChange, error, hint, placeholder, rows = 5 }: FieldProps & { rows?: number }) {
  return (
    <FieldGroup label={label} htmlFor={id} error={error} hint={hint}>
      <textarea
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={Boolean(error) || undefined}
        required
        rows={rows}
        placeholder={placeholder}
        className={`w-full rounded-lg border bg-white px-3 py-2.5 text-sm text-ink outline-none transition placeholder:text-muted-foreground/70 focus:ring-2 ${
          error ? 'border-red-400 focus:ring-red-500/15' : 'border-line focus:border-brand-blue focus:ring-brand-blue/15'
        }`}
      />
    </FieldGroup>
  )
}
