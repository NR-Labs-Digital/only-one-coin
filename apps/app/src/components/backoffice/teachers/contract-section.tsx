'use client'

import { useState, type FormEvent } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import type { FieldErrorCode } from '@ooc/domain/fields'
import { useRouter } from '@/i18n/navigation'
import type { TeacherContract, TeacherDetail, TeacherStatus } from '@/lib/backoffice/types'
import { formatDateRange, formatDateTime, formatFileSize, type Locale } from '@/lib/format'
import { ContractBadge } from '@/components/backoffice/contract-badge'
import { BoIcon } from '@/components/backoffice/icons'
import { AutoGrid } from '@/components/layout/auto-grid'
import { FieldMessage } from '../field-message'
import {
  contractDownloadUrl,
  fileContract,
  type ContractField,
  type ContractFilingFailure,
} from '@/lib/backoffice/contract-filing'

const fieldClass =
  'rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink outline-none transition focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/15'

const labelClass = 'text-xs font-medium uppercase tracking-wide text-muted-foreground'

/**
 * The contract block of the teacher file (OOC-81): where the contract stands,
 * the one in force, the ones before it, and — for whoever edits the file —
 * filing a new one. Filing never replaces a row: the newest is in force and
 * the rest stay downloadable, which is what "o documento continua arquivado"
 * means (CLAUDE.md §1).
 *
 * File, start and end are one form with one button: half a contract is never
 * filed.
 */
export function ContractSection({
  teacher,
  status,
  canEdit,
  canOpen,
}: {
  teacher: TeacherDetail
  /** The status as the file currently shows it — it may have just changed. */
  status: TeacherStatus
  canEdit: boolean
  canOpen: boolean
}) {
  const t = useTranslations('bo')
  const locale = useLocale() as Locale
  const router = useRouter()

  const [filing, setFiling] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [startsOn, setStartsOn] = useState('')
  const [endsOn, setEndsOn] = useState('')
  const [pending, setPending] = useState(false)
  const [failure, setFailure] = useState<ContractFilingFailure | null>(null)
  const [opening, setOpening] = useState<string | null>(null)
  const [openFailed, setOpenFailed] = useState(false)
  const [filed, setFiled] = useState(false)

  const current = teacher.contract
  const earlier = teacher.contracts.filter((contract) => contract.id !== current?.id)
  const outOfOrder = startsOn !== '' && endsOn !== '' && startsOn > endsOn
  const complete = file !== null && startsOn !== '' && endsOn !== '' && !outOfOrder

  const fieldError = (key: ContractField): FieldErrorCode | undefined =>
    failure?.kind === 'invalid' ? failure.fields[key] : undefined

  const failureMessage =
    failure === null
      ? null
      : failure.kind === 'not_pdf'
        ? t('teachers.contract_error_not_pdf')
        : failure.kind === 'too_large'
          ? t('teachers.contract_error_too_large', {
              size: formatFileSize(failure.maxBytes, locale),
            })
          : failure.kind === 'invalid'
            ? t('new_student.invalid_error')
            : t('teachers.contract_error_generic')

  function reset() {
    setFile(null)
    setStartsOn('')
    setEndsOn('')
    setFailure(null)
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!file || !complete) return
    setPending(true)
    setFailure(null)
    const result = await fileContract({ teacherId: teacher.id, file, startsOn, endsOn })
    setPending(false)
    if (!result.ok) {
      setFailure(result.failure)
      return
    }
    reset()
    setFiling(false)
    setFiled(true)
    router.refresh()
  }

  async function open(contract: TeacherContract) {
    setOpening(contract.id)
    setOpenFailed(false)
    const url = await contractDownloadUrl(teacher.id, contract.id)
    setOpening(null)
    if (!url) {
      setOpenFailed(true)
      return
    }
    // The link answers with `Content-Disposition: attachment`, so the page
    // stays where it is and the browser saves the PDF.
    window.location.assign(url)
  }

  const downloadButton = (contract: TeacherContract) =>
    canOpen && (
      <button
        type="button"
        onClick={() => void open(contract)}
        disabled={opening !== null}
        aria-label={t('teachers.contract_download_label', { name: contract.fileName })}
        className="inline-flex min-h-tap items-center gap-1.5 rounded-lg border border-line bg-white px-3 py-1.5 text-sm font-semibold text-ink transition hover:bg-cream disabled:opacity-50"
      >
        <BoIcon
          name={opening === contract.id ? 'spinner' : 'download'}
          size={15}
          className={opening === contract.id ? 'animate-spin' : undefined}
        />
        {t('teachers.contract_download')}
      </button>
    )

  return (
    <div className="mt-5 border-t border-line pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t('teachers.section_contract')}
        </p>
        {/* Nothing to warn about off the roster: the countdown is there to stop
            somebody teaching on a lapsed contract, and nobody inactive is
            teaching. The document itself stays on file. */}
        {status === 'active' ? (
          <ContractBadge
            contract={current}
            daysLeft={teacher.contractDaysLeft}
            alertDays={teacher.contractAlertDays}
          />
        ) : (
          <span className="text-xs text-muted-foreground">{t('teachers.contract_inactive')}</span>
        )}
      </div>

      {current ? (
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-line bg-sky-soft px-3 py-2.5">
          <BoIcon name="doc" size={16} className="shrink-0 text-brand-blue" />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-sm font-semibold text-ink">{current.fileName}</span>
            <span className="truncate text-xs text-muted-foreground">
              {t('teachers.contract_file_meta', {
                date: formatDateTime(current.uploadedAt, locale),
                size: formatFileSize(current.fileSizeBytes, locale),
              })}
            </span>
          </span>
          <span className="text-xs font-medium tabular-nums text-muted-foreground">
            {formatDateRange(current.startsAt, current.endsAt, locale)}
          </span>
          {downloadButton(current)}
        </div>
      ) : (
        <p className="mt-3 text-xs text-muted-foreground">{t('teachers.contract_none_body')}</p>
      )}

      {openFailed && (
        <p role="alert" className="mt-2 text-xs font-semibold text-red-600">
          {t('teachers.contract_error_open')}
        </p>
      )}
      {filed && !filing && (
        <p role="status" className="mt-2 text-xs font-semibold text-emerald-700">
          {t('teachers.contract_filed')}
        </p>
      )}

      {canEdit && !filing && (
        <button
          type="button"
          onClick={() => {
            setFiled(false)
            setFiling(true)
          }}
          className="mt-3 inline-flex min-h-tap items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-sm font-semibold text-muted-foreground transition hover:text-ink"
        >
          <BoIcon name="plus" size={15} />
          {current ? t('teachers.contract_replace') : t('teachers.contract_file')}
        </button>
      )}

      {canEdit && filing && (
        <form onSubmit={(event) => void submit(event)} className="mt-3 flex flex-col gap-3">
          <p className="text-xs text-muted-foreground">{t('teachers.contract_form_hint')}</p>
          <AutoGrid min="14rem" gap="gap-3">
            <label className="flex flex-col gap-1">
              <span className={labelClass}>{t('teachers.field_contract_file')}</span>
              <input
                type="file"
                accept="application/pdf,.pdf"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                className={`${fieldClass} file:mr-3 file:rounded-md file:border-0 file:bg-sky-soft file:px-2 file:py-1 file:text-sm file:font-semibold file:text-brand-blue`}
              />
              <FieldMessage code={fieldError('fileName')} />
            </label>
            <label className="flex flex-col gap-1">
              <span className={labelClass}>{t('teachers.field_contract_starts')}</span>
              <input
                type="date"
                value={startsOn}
                onChange={(event) => setStartsOn(event.target.value)}
                className={fieldClass}
              />
              <FieldMessage code={fieldError('startsOn')} />
            </label>
            <label className="flex flex-col gap-1">
              <span className={labelClass}>{t('teachers.field_contract_ends')}</span>
              <input
                type="date"
                value={endsOn}
                min={startsOn || undefined}
                onChange={(event) => setEndsOn(event.target.value)}
                className={fieldClass}
              />
              <FieldMessage code={fieldError('endsOn')} />
              {outOfOrder && (
                <span className="text-xs font-medium text-red-600">
                  {t('teachers.contract_dates_out_of_order')}
                </span>
              )}
            </label>
          </AutoGrid>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="submit"
              disabled={pending || !complete}
              className="inline-flex min-h-tap items-center gap-1.5 rounded-lg bg-brand-blue px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-brand-blue-deep disabled:cursor-not-allowed disabled:opacity-40"
            >
              <BoIcon
                name={pending ? 'spinner' : 'check'}
                size={16}
                className={pending ? 'animate-spin' : undefined}
              />
              {pending ? t('teachers.contract_filing') : t('teachers.contract_submit')}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                reset()
                setFiling(false)
              }}
              className="min-h-tap rounded-lg border border-line px-3.5 py-2 text-sm font-semibold text-muted-foreground transition hover:text-ink"
            >
              {t('teacher_file.cancel')}
            </button>
            {failureMessage && (
              <span role="alert" className="text-xs font-semibold text-red-600">
                {failureMessage}
              </span>
            )}
          </div>
        </form>
      )}

      {earlier.length > 0 && (
        <details className="mt-4">
          <summary className="cursor-pointer text-xs font-semibold text-muted-foreground hover:text-ink">
            {t('teachers.contract_history', { count: earlier.length })}
          </summary>
          <ul className="mt-2 flex flex-col gap-2">
            {earlier.map((contract) => (
              <li
                key={contract.id}
                className="flex flex-wrap items-center gap-3 rounded-lg border border-line px-3 py-2"
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm text-ink">{contract.fileName}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {t('teachers.contract_file_meta', {
                      date: formatDateTime(contract.uploadedAt, locale),
                      size: formatFileSize(contract.fileSizeBytes, locale),
                    })}
                  </span>
                </span>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {formatDateRange(contract.startsAt, contract.endsAt, locale)}
                </span>
                {downloadButton(contract)}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}
