'use client'

import { useEffect, useMemo, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { StatusBadge, type Tone } from '@/components/backoffice/ui'
import { BoIcon } from '@/components/backoffice/icons'

/** `GET …/progression` (OOC-156). */
interface ProgressionPreview {
  classGroupModuleId: string
  module: number | null
  next: { id: string; module: number } | null
  lastModule: boolean
  passingGrade: number
  requiresPassingGrade: boolean
  seats: {
    enrollmentId: string
    firstName: string
    lastName: string
    attempt: number
    grade: number | null
    didNotSit: boolean
    verdict: Verdict
  }[]
}

type Verdict = 'passed' | 'below_passing' | 'did_not_sit' | 'not_graded' | 'not_official'
type Choice = 'advance' | 'repeat' | 'none'

const CHOICES: readonly Choice[] = ['advance', 'repeat', 'none']

const VERDICT_TONE: Record<Verdict, Tone> = {
  passed: 'success',
  below_passing: 'warning',
  did_not_sit: 'warning',
  not_graded: 'neutral',
  // The register is not confirmed yet (OOC-180): nobody moves on a grade in review.
  not_official: 'neutral',
}

/** Every refusal the progression routes answer with, as the locale names them. */
const KNOWN_ERRORS = new Set([
  'closed',
  'empty',
  'unknown_enrollment',
  'duplicate_enrollment',
  'not_graded',
  'not_official',
  'no_next_run',
  'below_passing',
  'reason_required',
  'conflict',
])

const REASON_MAX = 500

const primaryButtonClass =
  'inline-flex min-h-tap items-center justify-center gap-1.5 rounded-lg bg-brand-blue px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-brand-blue-deep disabled:cursor-not-allowed disabled:opacity-40'

/**
 * Moving the students of one module run on (OOC-156): who advances to the next
 * module's group, who repeats this one. The same panel for the teacher (their
 * own run, from the portal) and for coordination (any run, from the
 * backoffice) — `endpoint` is each one's door, `canForce` whether advancing
 * below the pass mark is offered, with its reason.
 *
 * The screen proposes; the API decides. Each row starts from what the grade
 * says — passed advances, below or DA repeats, no grade waits — and the person
 * changes what they need before confirming. Nothing moves until they do.
 */
export function ProgressionPanel({
  endpoint,
  canForce,
  onDone,
}: {
  /** Same-origin path to `GET`/`POST` the run's progression. */
  endpoint: string
  canForce: boolean
  onDone: (result: { advanced: number; repeated: number }) => void
}) {
  const t = useTranslations('bo')
  const locale = useLocale()
  const [preview, setPreview] = useState<ProgressionPreview | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [choices, setChoices] = useState<Record<string, Choice>>({})
  const [reason, setReason] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(endpoint)
      .then((response) => (response.ok ? (response.json() as Promise<ProgressionPreview>) : null))
      .then((data) => {
        if (cancelled) return
        if (!data) {
          setLoadFailed(true)
          return
        }
        setPreview(data)
        setChoices(
          Object.fromEntries(
            data.seats.map((seat) => [
              seat.enrollmentId,
              seat.verdict === 'not_graded' || seat.verdict === 'not_official'
                ? 'none'
                : seat.verdict === 'passed' && data.next
                  ? 'advance'
                  : seat.verdict === 'passed'
                    ? 'none'
                    : 'repeat',
            ]),
          ),
        )
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [endpoint])

  const grade = useMemo(() => new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }), [locale])

  if (loadFailed) {
    return (
      <p role="alert" className="text-sm text-red-700">
        {t('progression.load_error')}
      </p>
    )
  }
  if (!preview) return <p className="text-sm text-muted-foreground">{t('progression.loading')}</p>

  const below = (verdict: Verdict) => verdict === 'below_passing' || verdict === 'did_not_sit'
  /** Advancing this seat goes past the pass mark — only coordination, with a reason. */
  const forcing = (verdict: Verdict) => preview.requiresPassingGrade && below(verdict)
  const forced = preview.seats.filter(
    (seat) => choices[seat.enrollmentId] === 'advance' && forcing(seat.verdict),
  )
  const advance = preview.seats.filter((seat) => choices[seat.enrollmentId] === 'advance').map((seat) => seat.enrollmentId)
  const repeat = preview.seats.filter((seat) => choices[seat.enrollmentId] === 'repeat').map((seat) => seat.enrollmentId)
  const reasonMissing = forced.length > 0 && (reason.trim() === '' || reason.trim().length > REASON_MAX)
  const ready = advance.length + repeat.length > 0 && !reasonMissing && !pending

  async function submit() {
    if (!ready) return
    setPending(true)
    setError(null)
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ advance, repeat, ...(canForce ? { reason: reason.trim() || null } : {}) }),
      })
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { reason?: string } | null
        const code = body?.reason?.replace('teaching.progression_', '') ?? ''
        setError(KNOWN_ERRORS.has(code) ? code : 'failed')
        return
      }
      onDone((await response.json()) as { advanced: number; repeated: number })
    } catch {
      setError('failed')
    } finally {
      setPending(false)
    }
  }

  const gradeText = (seat: ProgressionPreview['seats'][number]) =>
    seat.didNotSit ? t('progression.did_not_sit_mark') : seat.grade === null ? '—' : grade.format(seat.grade)

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        {preview.next
          ? t('progression.intro', { module: preview.next.module, grade: preview.passingGrade })
          : t(preview.lastModule ? 'progression.last_module' : 'progression.no_next_run', {
              module: (preview.module ?? 0) + 1,
            })}
      </p>
      {!preview.requiresPassingGrade && (
        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <BoIcon name="help" size={14} className="mt-0.5 shrink-0" />
          {t('progression.pass_mark_off')}
        </p>
      )}

      {preview.seats.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('progression.no_students')}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line rounded-lg border border-line">
          {preview.seats.map((seat) => {
            const choice = choices[seat.enrollmentId] ?? 'none'
            const advanceBlocked =
              preview.next === null ||
              seat.verdict === 'not_graded' ||
              seat.verdict === 'not_official' ||
              (forcing(seat.verdict) && !canForce)
            return (
              <li key={seat.enrollmentId} className="flex flex-wrap items-center justify-between gap-3 p-3">
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-semibold text-ink">
                    {`${seat.lastName}, ${seat.firstName}`}
                  </span>
                  <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    <span className="tabular-nums">{gradeText(seat)}</span>
                    <StatusBadge tone={VERDICT_TONE[seat.verdict]} label={t(`progression.verdict_${seat.verdict}`)} />
                    {seat.attempt > 1 && <span>{t('progression.attempt', { attempt: seat.attempt })}</span>}
                  </span>
                </span>
                <fieldset
                  className="flex flex-wrap gap-1.5"
                  disabled={seat.verdict === 'not_graded' || seat.verdict === 'not_official' || pending}
                >
                  <legend className="sr-only">{`${seat.firstName} ${seat.lastName}`}</legend>
                  {CHOICES.map((option) => {
                    const disabled = option === 'advance' && advanceBlocked
                    return (
                      <button
                        key={option}
                        type="button"
                        disabled={disabled}
                        aria-pressed={choice === option}
                        onClick={() => setChoices((current) => ({ ...current, [seat.enrollmentId]: option }))}
                        className={`min-h-tap rounded-full px-3 py-1.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${
                          choice === option
                            ? option === 'advance' && forcing(seat.verdict)
                              ? 'bg-amber-600 text-white'
                              : 'bg-brand-blue text-white'
                            : 'border border-line bg-white text-muted-foreground hover:text-ink'
                        }`}
                      >
                        {t(`progression.choice_${option}`)}
                      </button>
                    )
                  })}
                </fieldset>
              </li>
            )
          })}
        </ul>
      )}

      {forced.length > 0 && (
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t('progression.reason_label', { count: forced.length })}
          </span>
          <textarea
            value={reason}
            maxLength={REASON_MAX}
            onChange={(event) => setReason(event.target.value)}
            rows={3}
            placeholder={t('progression.reason_placeholder')}
            className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink outline-none transition focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/15"
          />
        </label>
      )}

      <div className="flex flex-col gap-2">
        <p className="text-xs text-muted-foreground">
          {t('progression.summary', { advance: advance.length, repeat: repeat.length })}
        </p>
        <button type="button" disabled={!ready} onClick={() => void submit()} className={primaryButtonClass}>
          <BoIcon name="check" size={16} />
          {t('progression.confirm')}
        </button>
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-700">
          {t(`progression.error_${error}`)}
        </p>
      )}
    </div>
  )
}
