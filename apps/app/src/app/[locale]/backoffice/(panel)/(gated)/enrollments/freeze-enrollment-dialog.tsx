'use client'

import { useEffect, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import type { EnrollmentRow, WeeklySlotItem } from '@/lib/backoffice/types'
import { slotsLabel } from '@/lib/backoffice/schedule'
import { formatDate, type Locale } from '@/lib/format'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

/** A module run a frozen enrollment can come back to, as `GET /enrollments/:id/return-runs` serves it. */
interface ReturnRun {
  id: string
  classGroupId: string
  code: string
  module: number | null
  startsOn: string | null
  slots: WeeklySlotItem[]
  capacity: number
  seatsTaken: number
}

/** The refusals the API names (without the `enrollment.` prefix); anything else is `failed`. */
const KNOWN_ERRORS = new Set([
  'freeze_seat_not_confirmed',
  'freeze_course_disallows',
  'freeze_class_group_not_running',
  'freeze_reason_required',
  'freeze_conflict',
  'return_not_frozen',
  'return_target_unavailable',
  'class_group_full',
])

export type FreezeMode = 'freeze' | 'return'

/**
 * Freezing an enrollment and bringing it back (OOC-84), the staff's door.
 * Freezing asks for the reason — it goes to the audit log — and gives the seat
 * back to the class group. Coming back offers the open groups of the module
 * the student stopped in, of the same course; a full one asks for the
 * over-capacity confirmation first (OOC-155). Nothing is charged here: the
 * student's paid request goes through Payments.
 */
export function FreezeEnrollmentDialog({
  enrollment,
  mode,
  onClose,
  onDone,
}: {
  enrollment: EnrollmentRow | null
  mode: FreezeMode
  onClose: () => void
  onDone: (result: { mode: FreezeMode; overCapacity: boolean }) => void
}) {
  const t = useTranslations('bo')
  const locale = useLocale() as Locale

  const [reason, setReason] = useState('')
  const [runs, setRuns] = useState<ReturnRun[] | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [runId, setRunId] = useState('')
  const [fullOnServer, setFullOnServer] = useState(false)
  const [overCapacityConfirmed, setOverCapacityConfirmed] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const enrollmentId = enrollment?.id ?? null

  useEffect(() => {
    if (!enrollmentId) return
    let cancelled = false
    setReason('')
    setRuns(null)
    setLoadFailed(false)
    setRunId('')
    setFullOnServer(false)
    setOverCapacityConfirmed(false)
    setError(null)
    if (mode !== 'return') return
    fetch(`/api/v1/enrollments/${enrollmentId}/return-runs`)
      .then((response) => (response.ok ? (response.json() as Promise<{ runs: ReturnRun[] }>) : null))
      .then((data) => {
        if (cancelled) return
        if (data && Array.isArray(data.runs)) setRuns(data.runs)
        else setLoadFailed(true)
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [enrollmentId, mode])

  const run = runs?.find((item) => item.id === runId) ?? null
  const runFull = run !== null && (run.seatsTaken >= run.capacity || fullOnServer)
  const ready =
    !pending &&
    (mode === 'freeze' ? reason.trim().length > 0 : run !== null && (!runFull || overCapacityConfirmed))

  async function submit() {
    if (!ready || !enrollmentId) return
    setPending(true)
    setError(null)
    try {
      const response =
        mode === 'freeze'
          ? await fetch(`/api/v1/enrollments/${enrollmentId}/freeze`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ reason: reason.trim() }),
            })
          : await fetch(`/api/v1/enrollments/${enrollmentId}/return`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ classGroupModuleId: runId, allowOverCapacity: runFull && overCapacityConfirmed }),
            })
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { reason?: string } | null
        const code = (body?.reason ?? '').replace(/^enrollment\./, '')
        if (code === 'class_group_full') {
          setFullOnServer(true)
          setOverCapacityConfirmed(false)
        }
        setError(KNOWN_ERRORS.has(code) ? code : 'failed')
        return
      }
      const result = (await response.json()) as { overCapacity?: boolean }
      onDone({ mode, overCapacity: result.overCapacity === true })
    } catch {
      setError('failed')
    } finally {
      setPending(false)
    }
  }

  const fieldClass =
    'w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink outline-none transition focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/15'
  const labelClass = 'text-xs font-medium uppercase tracking-wide text-muted-foreground'

  const optionLabel = (item: ReturnRun) => {
    const values = {
      code: item.code,
      module: item.module ?? 0,
      schedule: slotsLabel(item.slots, t),
      start: item.startsOn ? formatDate(item.startsOn, locale) : t('freeze_enrollment.no_start'),
    }
    return item.module === null
      ? t('freeze_enrollment.run_option_no_module', values)
      : t('freeze_enrollment.run_option', values)
  }

  return (
    <Dialog
      open={enrollment !== null}
      onOpenChange={(open) => {
        if (!open && !pending) onClose()
      }}
    >
      <DialogContent closeLabel={t('freeze_enrollment.cancel')} className="bg-white">
        {enrollment && (
          <>
            <DialogHeader className="gap-2 border-b border-line p-5 pr-14">
              <DialogTitle className="text-base font-semibold text-ink">
                {t(mode === 'freeze' ? 'freeze_enrollment.freeze_title' : 'freeze_enrollment.return_title')}
              </DialogTitle>
              <DialogDescription>
                {mode === 'freeze'
                  ? t('freeze_enrollment.freeze_subtitle', {
                      student: enrollment.studentName,
                      from: enrollment.classGroupName,
                    })
                  : t('freeze_enrollment.return_subtitle', { student: enrollment.studentName })}
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-4 p-5">
              {mode === 'freeze' ? (
                <label className="flex flex-col gap-1">
                  <span className={labelClass}>{t('freeze_enrollment.field_reason')}</span>
                  <textarea
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    rows={3}
                    maxLength={500}
                    placeholder={t('freeze_enrollment.reason_placeholder')}
                    className={fieldClass}
                  />
                </label>
              ) : loadFailed ? (
                <p role="alert" className="text-sm text-red-700">
                  {t('freeze_enrollment.load_error')}
                </p>
              ) : runs === null ? (
                <p className="text-sm text-muted-foreground">{t('freeze_enrollment.loading')}</p>
              ) : runs.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('freeze_enrollment.no_runs')}</p>
              ) : (
                <>
                  <label className="flex flex-col gap-1">
                    <span className={labelClass}>{t('freeze_enrollment.field_run')}</span>
                    <select
                      value={runId}
                      onChange={(event) => {
                        setRunId(event.target.value)
                        setFullOnServer(false)
                        setOverCapacityConfirmed(false)
                        setError(null)
                      }}
                      className={fieldClass}
                    >
                      <option value="">{t('freeze_enrollment.run_placeholder')}</option>
                      {runs.map((item) => (
                        <option key={item.id} value={item.id}>
                          {optionLabel(item)}
                        </option>
                      ))}
                    </select>
                  </label>
                  {run && (
                    <p className="text-xs text-muted-foreground">
                      {t('freeze_enrollment.seats', { taken: run.seatsTaken, capacity: run.capacity })}
                    </p>
                  )}
                  {runFull && (
                    <div className="flex flex-col gap-2 rounded-lg border border-amber-600/20 bg-amber-50 p-3">
                      <p className="text-sm font-semibold text-amber-900">{t('freeze_enrollment.over_capacity_title')}</p>
                      <label className="flex items-start gap-2 text-sm text-amber-900">
                        <input
                          type="checkbox"
                          checked={overCapacityConfirmed}
                          onChange={(event) => setOverCapacityConfirmed(event.target.checked)}
                          className="mt-0.5"
                        />
                        {t('freeze_enrollment.over_capacity_body')}
                      </label>
                    </div>
                  )}
                </>
              )}

              <p className="text-xs text-muted-foreground">{t('freeze_enrollment.fee_notice')}</p>

              {error && (
                <p role="alert" className="text-sm text-red-700">
                  {t(`freeze_enrollment.error.${error}`)}
                </p>
              )}

              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={pending}
                  className="inline-flex min-h-tap items-center justify-center rounded-lg border border-line px-3 py-2 text-sm font-semibold text-ink transition hover:bg-sky-soft disabled:opacity-60"
                >
                  {t('freeze_enrollment.cancel')}
                </button>
                <button
                  type="button"
                  onClick={() => void submit()}
                  disabled={!ready}
                  className="inline-flex min-h-tap items-center justify-center rounded-lg bg-brand-blue px-3 py-2 text-sm font-semibold text-white transition hover:bg-brand-blue-deep disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {pending
                    ? t('freeze_enrollment.saving')
                    : t(mode === 'freeze' ? 'freeze_enrollment.submit_freeze' : 'freeze_enrollment.submit_return')}
                </button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
