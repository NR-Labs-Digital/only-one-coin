'use client'

import { useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import type { TeacherContract, TeacherDetail, TeacherStatus } from '@/lib/backoffice/types'
import { formatDateRange, formatDateTime, formatFileSize, type Locale } from '@/lib/format'
import { ContractBadge } from '@/components/backoffice/contract-badge'
import { BoIcon } from '@/components/backoffice/icons'
import { ContractDownloadDialog } from './contract-download-dialog'
import { downloadRecordedContract, filedContractUrl } from '@/lib/backoffice/contract-download'

/**
 * The contract block of the teacher file: where the contract stands, the one
 * in force, the ones before it, and — for whoever edits the file — generating
 * a new one. Generating records the period with the template version it was
 * printed from (OOC-124); the signed copy is kept outside the platform, so
 * nothing is uploaded here. Recording never replaces a row: the newest is in
 * force and the rest stay downloadable. Contracts filed as a PDF before
 * OOC-124 still open by their file.
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

  const [opening, setOpening] = useState<string | null>(null)
  const [openFailed, setOpenFailed] = useState(false)
  const [generated, setGenerated] = useState(false)
  const [generating, setGenerating] = useState(false)

  const current = teacher.contract
  const earlier = teacher.contracts.filter((contract) => contract.id !== current?.id)
  const teacherName = `${teacher.firstName} ${teacher.lastName}`

  async function open(contract: TeacherContract) {
    setOpening(contract.id)
    setOpenFailed(false)
    if (contract.file) {
      const url = await filedContractUrl(teacher.id, contract.id)
      setOpening(null)
      if (!url) {
        setOpenFailed(true)
        return
      }
      // The link answers with `Content-Disposition: attachment`, so the page
      // stays where it is and the browser saves the PDF.
      window.location.assign(url)
      return
    }
    const result = await downloadRecordedContract({
      teacherId: teacher.id,
      contractId: contract.id,
      fileName: t('teachers.contract_download_file_name', { name: teacherName }),
    })
    setOpening(null)
    if (!result.ok) setOpenFailed(true)
  }

  /** What the row says about where the contract came from. */
  const meta = (contract: TeacherContract) =>
    contract.file
      ? t('teachers.contract_file_meta', {
          date: formatDateTime(contract.recordedAt, locale),
          size: formatFileSize(contract.file.sizeBytes, locale),
        })
      : t('teachers.contract_generated_meta', {
          date: formatDateTime(contract.recordedAt, locale),
          version: contract.templateVersion ?? 0,
        })

  const downloadButton = (contract: TeacherContract) =>
    canOpen && (
      <button
        type="button"
        onClick={() => void open(contract)}
        disabled={opening !== null}
        aria-label={t('teachers.contract_download_label', {
          period: formatDateRange(contract.startsAt, contract.endsAt, locale),
        })}
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
            teaching. The record itself stays. */}
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
            <span className="truncate text-sm font-semibold tabular-nums text-ink">
              {formatDateRange(current.startsAt, current.endsAt, locale)}
            </span>
            <span className="truncate text-xs text-muted-foreground">{meta(current)}</span>
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
      {generated && (
        <p role="status" className="mt-2 text-xs font-semibold text-emerald-700">
          {t('teachers.contract_recorded')}
        </p>
      )}

      {canEdit && (
        <div className="mt-3 flex flex-wrap gap-2">
          {/* The contract to print and sign, filled from this file and the
              published template; generating it records the period (OOC-124). */}
          <button
            type="button"
            onClick={() => {
              setGenerated(false)
              setGenerating(true)
            }}
            className="inline-flex min-h-tap items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-sm font-semibold text-brand-blue transition hover:bg-sky-soft"
          >
            <BoIcon name="doc" size={15} />
            {t('teachers.contract_download_action')}
          </button>
        </div>
      )}

      {canEdit && (
        <ContractDownloadDialog
          open={generating}
          teacherId={teacher.id}
          teacherName={teacherName}
          onClose={() => setGenerating(false)}
          onGenerated={() => {
            setGenerating(false)
            setGenerated(true)
            router.refresh()
          }}
        />
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
                  <span className="truncate text-sm tabular-nums text-ink">
                    {formatDateRange(contract.startsAt, contract.endsAt, locale)}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">{meta(contract)}</span>
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
