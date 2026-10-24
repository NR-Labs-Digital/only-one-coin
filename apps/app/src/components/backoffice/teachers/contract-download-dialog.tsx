'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { BoIcon } from '@/components/backoffice/icons'
import { AutoGrid } from '@/components/layout/auto-grid'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

/** Why the contract did not come out, as something the dialog can say. */
type ContractDownloadFailure =
  | 'not_published'
  | 'out_of_order'
  | 'missing_value'
  | 'unavailable'
  | 'failed'

const ERROR_KEY = {
  not_published: 'teachers.contract_download_error_not_published',
  out_of_order: 'teachers.contract_dates_out_of_order',
  missing_value: 'teachers.contract_download_error_missing_value',
  unavailable: 'teachers.contract_download_error_unavailable',
  failed: 'teachers.contract_download_error_failed',
} as const satisfies Record<ContractDownloadFailure, string>

/** The API's `reason`, reduced to the dialog's message — never shown as is (CLAUDE.md §4). */
function failureOf(status: number, reason: string | undefined): ContractDownloadFailure {
  if (reason === 'document_template.not_published') return 'not_published'
  if (reason === 'teacher_contract.period_out_of_order') return 'out_of_order'
  if (reason === 'document_template.missing_value') return 'missing_value'
  if (status === 503) return 'unavailable'
  return 'failed'
}

/** Today in Lima, `YYYY-MM-DD` — the day the contract would usually start. */
function todayInLima(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(new Date())
}

const fieldClass =
  'w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink outline-none transition focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/15'

const labelClass =
  'text-xs font-medium uppercase tracking-wide text-muted-foreground'

/**
 * Downloads the teacher contract, filled from the file and the published
 * template (OOC-123). The period is asked here because the contract prints
 * it; nothing is recorded — the PDF is built on demand and the signed copy is
 * kept outside the platform (decision of 23/10/2026; recording the period is
 * OOC-124).
 */
export function ContractDownloadDialog({
  open,
  teacherId,
  teacherName,
  onClose,
}: {
  open: boolean
  teacherId: string
  teacherName: string
  onClose: () => void
}) {
  const t = useTranslations('bo')
  const [startsOn, setStartsOn] = useState('')
  const [endsOn, setEndsOn] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<ContractDownloadFailure | null>(null)

  useEffect(() => {
    if (!open) return
    setStartsOn(todayInLima())
    setEndsOn('')
    setError(null)
  }, [open])

  const outOfOrder = startsOn !== '' && endsOn !== '' && endsOn <= startsOn
  const ready = startsOn !== '' && endsOn !== '' && !outOfOrder && !pending

  async function download() {
    if (!ready) return
    setPending(true)
    setError(null)
    try {
      const response = await fetch(
        `/api/v1/teachers/${encodeURIComponent(teacherId)}/contract-document`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ startsOn, endsOn }),
        },
      )
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { reason?: string } | null
        setError(failureOf(response.status, body?.reason))
        return
      }
      const url = URL.createObjectURL(await response.blob())
      const link = document.createElement('a')
      link.href = url
      link.download = t('teachers.contract_download_file_name', { name: teacherName })
      link.click()
      URL.revokeObjectURL(url)
      onClose()
    } catch {
      setError('failed')
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !pending) onClose()
      }}
    >
      <DialogContent closeLabel={t('teachers.contract_download_close')} className="bg-white">
        <DialogHeader className="gap-2 border-b border-line p-5 pr-14">
          <DialogTitle className="text-base font-semibold text-ink">
            {t('teachers.contract_download_title')}
          </DialogTitle>
        </DialogHeader>

        <form
          onSubmit={(event) => {
            event.preventDefault()
            void download()
          }}
        >
          <div className="flex flex-col gap-4 p-5">
            <p className="text-sm text-muted-foreground">{t('teachers.contract_download_hint')}</p>
            <AutoGrid min="11rem" gap="gap-3">
              <label className="flex flex-col gap-1">
                <span className={labelClass}>{t('teachers.contract_download_starts')}</span>
                <input
                  type="date"
                  required
                  value={startsOn}
                  onChange={(event) => setStartsOn(event.target.value)}
                  className={fieldClass}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className={labelClass}>{t('teachers.contract_download_ends')}</span>
                <input
                  type="date"
                  required
                  min={startsOn || undefined}
                  value={endsOn}
                  onChange={(event) => setEndsOn(event.target.value)}
                  className={fieldClass}
                />
              </label>
            </AutoGrid>

            {(outOfOrder || error) && (
              <p role="alert" className="text-xs font-semibold text-red-600">
                {t(ERROR_KEY[outOfOrder ? 'out_of_order' : error!])}
              </p>
            )}

            {/* WeasyPrint takes a second or two; say so instead of looking stuck. */}
            {pending && (
              <p className="flex items-center gap-2 text-xs text-muted-foreground" aria-live="polite">
                <BoIcon name="spinner" size={14} className="animate-spin" />
                {t('teachers.contract_download_pending')}
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line p-5">
            <button
              type="button"
              onClick={onClose}
              disabled={pending}
              className="rounded-lg border border-line px-3.5 py-2 text-sm font-semibold text-muted-foreground transition hover:text-ink disabled:cursor-not-allowed disabled:opacity-60"
            >
              {t('teachers.contract_download_cancel')}
            </button>
            <button
              type="submit"
              disabled={!ready}
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand-blue px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-brand-blue-deep disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-brand-blue"
            >
              <BoIcon
                name={pending ? 'spinner' : 'download'}
                size={16}
                className={pending ? 'animate-spin' : undefined}
              />
              {t('teachers.contract_download_confirm')}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
