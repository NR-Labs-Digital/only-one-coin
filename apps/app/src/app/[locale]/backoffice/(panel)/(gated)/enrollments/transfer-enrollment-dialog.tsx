'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import type { EnrollmentRow, NationalIdType } from '@/lib/backoffice/types'
import { BoIcon } from '@/components/backoffice/icons'
import { HelpHint } from '@/components/backoffice/help-hint'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

/** The API's own floor for `GET /api/v1/students/search?q=` — shorter is not a search. */
const MIN_QUERY_LENGTH = 2
const SEARCH_DEBOUNCE_MS = 250

interface StudentMatch {
  id: string
  firstName: string
  lastName: string
  nationalIdType: NationalIdType
  nationalId: string
}

/** The refusals the API names (without the `enrollment.` prefix); anything else is `failed`. */
const KNOWN_ERRORS = new Set([
  'transfer_seat_not_confirmed',
  'transfer_course_disallows',
  'transfer_class_group_not_running',
  'transfer_graded',
  'transfer_procedure_open',
  'transfer_same_student',
  'transfer_student_already_enrolled',
  'transfer_student_below_minimum_age',
  'transfer_guardian_required',
  'transfer_reason_required',
  'transfer_student_not_found',
  'transfer_conflict',
])

export type TransferPortalAccess = 'created' | 'linked_existing' | 'already_linked' | 'email_conflict'

/**
 * Traspaso de matrícula (OOC-105): the enrollment goes to another student
 * already on file — the seat, the class group and the payment with it. Free
 * of charge, with the reason in the audit log. Registering the person is its
 * own flow (it carries the guardian's consent), so this only searches.
 */
export function TransferEnrollmentDialog({
  enrollment,
  onClose,
  onDone,
}: {
  enrollment: EnrollmentRow | null
  onClose: () => void
  onDone: (result: { portalAccess: TransferPortalAccess }) => void
}) {
  const t = useTranslations('bo')

  const [query, setQuery] = useState('')
  const studentFieldId = useId()
  const [matches, setMatches] = useState<StudentMatch[] | null>(null)
  const [picked, setPicked] = useState<StudentMatch | null>(null)
  const [reason, setReason] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inflight = useRef<AbortController | null>(null)

  const enrollmentId = enrollment?.id ?? null

  useEffect(() => {
    setQuery('')
    setMatches(null)
    setPicked(null)
    setReason('')
    setError(null)
  }, [enrollmentId])

  useEffect(() => {
    const needle = query.trim()
    inflight.current?.abort()
    inflight.current = null
    if (needle.length < MIN_QUERY_LENGTH) {
      setMatches(null)
      return
    }
    const timer = window.setTimeout(() => {
      const controller = new AbortController()
      inflight.current = controller
      fetch(`/api/v1/students/search?q=${encodeURIComponent(needle)}`, { signal: controller.signal })
        .then((response) =>
          response.ok ? (response.json() as Promise<{ items?: StudentMatch[] }>) : { items: [] },
        )
        .then((page) => {
          if (inflight.current !== controller) return
          setMatches(Array.isArray(page?.items) ? page.items : [])
        })
        .catch(() => {
          if (controller.signal.aborted || inflight.current !== controller) return
          setMatches([])
        })
    }, SEARCH_DEBOUNCE_MS)
    return () => {
      window.clearTimeout(timer)
      inflight.current?.abort()
      inflight.current = null
    }
  }, [query])

  // The holder is refused by the API anyway (`transfer_same_student`).
  const offered = matches?.filter((match) => match.id !== enrollment?.studentId) ?? null
  const ready = !pending && picked !== null && reason.trim().length > 0

  async function submit() {
    if (!ready || !enrollmentId || !picked) return
    setPending(true)
    setError(null)
    try {
      const response = await fetch(`/api/v1/enrollments/${enrollmentId}/transfer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toStudentId: picked.id, reason: reason.trim() }),
      })
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { reason?: string } | null
        const code = (body?.reason ?? '').replace(/^enrollment\./, '')
        setError(KNOWN_ERRORS.has(code) ? code : 'failed')
        return
      }
      const result = (await response.json()) as { portalAccess?: TransferPortalAccess }
      onDone({ portalAccess: result.portalAccess ?? 'already_linked' })
    } catch {
      setError('failed')
    } finally {
      setPending(false)
    }
  }

  const fieldClass =
    'w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink outline-none transition focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/15'
  const labelClass = 'text-xs font-medium uppercase tracking-wide text-muted-foreground'

  const documentOf = (match: StudentMatch) =>
    t('students.document', { type: t(`national_id_type.${match.nationalIdType}`), number: match.nationalId })

  return (
    <Dialog
      open={enrollment !== null}
      onOpenChange={(open) => {
        if (!open && !pending) onClose()
      }}
    >
      <DialogContent closeLabel={t('transfer_enrollment.cancel')} className="bg-white">
        {enrollment && (
          <>
            <DialogHeader className="gap-2 border-b border-line p-5 pr-14">
              <DialogTitle className="text-base font-semibold text-ink">{t('transfer_enrollment.title')}</DialogTitle>
              <DialogDescription>
                {t('transfer_enrollment.subtitle', {
                  student: enrollment.studentName,
                  course: enrollment.courseName,
                  group: enrollment.classGroupName,
                })}
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-4 p-5">
              {picked ? (
                <div className="flex flex-col gap-1">
                  <span className="flex items-center gap-1.5">
                    <span className={labelClass}>{t('transfer_enrollment.field_student')}</span>
                    <HelpHint what={t('help.enr_transfer_student_what')} how={t('help.enr_transfer_student_how')} />
                  </span>
                  <div className="flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-2">
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-sm font-medium text-ink">{`${picked.firstName} ${picked.lastName}`}</span>
                      <span className="text-xs text-muted-foreground">{documentOf(picked)}</span>
                    </span>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => {
                        setPicked(null)
                        setError(null)
                      }}
                      className="inline-flex min-h-tap shrink-0 items-center rounded-lg px-2 text-sm font-semibold text-brand-blue transition hover:bg-sky-soft disabled:opacity-60"
                    >
                      {t('transfer_enrollment.change_student')}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  <div className="flex flex-col gap-1">
                    <span className="flex items-center gap-1.5">
                      <label htmlFor={studentFieldId} className={labelClass}>
                        {t('transfer_enrollment.field_student')}
                      </label>
                      <HelpHint what={t('help.enr_transfer_student_what')} how={t('help.enr_transfer_student_how')} />
                    </span>
                    <span className="relative">
                      <BoIcon
                        name="search"
                        size={16}
                        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                      />
                      <input
                        id={studentFieldId}
                        type="search"
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        placeholder={t('transfer_enrollment.search_placeholder')}
                        className={`${fieldClass} pl-9`}
                      />
                    </span>
                  </div>
                  {offered &&
                    (offered.length === 0 ? (
                      <p className="text-xs text-muted-foreground">{t('transfer_enrollment.no_students_found')}</p>
                    ) : (
                      <ul className="flex max-h-56 flex-col overflow-y-auto rounded-lg border border-line">
                        {offered.map((match) => (
                          <li key={match.id}>
                            <button
                              type="button"
                              onClick={() => {
                                setPicked(match)
                                setError(null)
                              }}
                              className="flex min-h-tap w-full flex-col items-start gap-0.5 border-b border-line/70 px-3 py-2 text-left transition last:border-b-0 hover:bg-sky-soft"
                            >
                              <span className="text-sm font-medium text-ink">{`${match.firstName} ${match.lastName}`}</span>
                              <span className="text-xs text-muted-foreground">{documentOf(match)}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    ))}
                  <p className="text-xs text-muted-foreground">{t('transfer_enrollment.registered_only')}</p>
                </div>
              )}

              <label className="flex flex-col gap-1">
                <span className={labelClass}>{t('transfer_enrollment.field_reason')}</span>
                <textarea
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  rows={3}
                  maxLength={500}
                  placeholder={t('transfer_enrollment.reason_placeholder')}
                  className={fieldClass}
                />
              </label>

              <p className="text-xs text-muted-foreground">{t('transfer_enrollment.notice')}</p>

              {error && (
                <p role="alert" className="text-sm text-red-700">
                  {t(`transfer_enrollment.error.${error}`)}
                </p>
              )}

              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={pending}
                  className="inline-flex min-h-tap items-center justify-center rounded-lg border border-line px-3 py-2 text-sm font-semibold text-ink transition hover:bg-sky-soft disabled:opacity-60"
                >
                  {t('transfer_enrollment.cancel')}
                </button>
                <button
                  type="button"
                  onClick={() => void submit()}
                  disabled={!ready}
                  className="inline-flex min-h-tap items-center justify-center rounded-lg bg-brand-blue px-3 py-2 text-sm font-semibold text-white transition hover:bg-brand-blue-deep disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {pending ? t('transfer_enrollment.saving') : t('transfer_enrollment.submit')}
                </button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
