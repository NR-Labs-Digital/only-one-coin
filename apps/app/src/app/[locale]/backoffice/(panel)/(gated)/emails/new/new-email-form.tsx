'use client'

import { useMemo, useRef, useState, type ChangeEvent } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import type { EnrollmentStatus } from '@/lib/backoffice/types'
import { Card, EmptyState, RequiredMark } from '@/components/backoffice/ui'
import { Toast } from '@/components/backoffice/controls'
import { BoIcon } from '@/components/backoffice/icons'
import { ProofSend } from '../proof-send'

/** Which question the segment asks. The answer is resolved at send time. */
type SegmentKind = 'all' | 'course' | 'class_group' | 'enrollment_status'

const KINDS: SegmentKind[] = ['all', 'course', 'class_group', 'enrollment_status']

/** Written by hand, or an HTML somebody designed elsewhere and brings in. */
type ContentMode = 'write' | 'html'

/** Enough matches to recognise the right one, few enough to read at a glance. */
const MAX_MATCHES = 6

const fieldClass =
  'w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink outline-none transition placeholder:text-muted-foreground focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/15'

const labelClass = 'text-xs font-medium uppercase tracking-wide text-muted-foreground'

const primaryButtonClass =
  'inline-flex items-center gap-1.5 rounded-lg bg-brand-blue px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-brand-yellow hover:text-ink active:bg-brand-yellow-deep disabled:cursor-not-allowed disabled:opacity-40'

const ghostButtonClass =
  'inline-flex items-center gap-1.5 rounded-lg border border-line bg-white px-3.5 py-2 text-sm font-semibold text-muted-foreground transition hover:text-ink'

/**
 * The stepper: where you are, what is behind you, and what is left. Horizontal
 * because the steps are a path across the top of the work, not a list beside
 * it — and because with one step on screen at a time, this strip is the only
 * thing telling somebody how much of the send they have already decided.
 *
 * Steps behind are links: going back to re-read what you wrote must never cost
 * the draft. Steps ahead are not — they are gated by what is missing here.
 */
function Stepper({
  steps,
  current,
  labelOf,
  onPick,
}: {
  steps: string[]
  current: number
  labelOf: (key: string) => string
  onPick: (key: string) => void
}) {
  return (
    <ol className="flex items-start gap-1 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {steps.map((key, position) => {
        const active = position === current
        const done = position < current
        return (
          <li key={key} className="flex min-w-0 flex-1 items-start gap-1">
            <button
              type="button"
              disabled={!done && !active}
              onClick={() => onPick(key)}
              aria-current={active ? 'step' : undefined}
              className="flex min-w-16 flex-1 flex-col items-center gap-1.5 px-0.5 text-center disabled:cursor-default"
            >
              <span
                className={`grid size-8 shrink-0 place-items-center rounded-full border text-sm font-semibold transition ${
                  active
                    ? 'border-brand-blue bg-brand-blue text-white'
                    : done
                      ? 'border-brand-yellow bg-brand-yellow text-ink'
                      : 'border-line bg-white text-muted-foreground'
                }`}
              >
                {done ? <BoIcon name="check" size={16} /> : position + 1}
              </span>
              <span
                /* Wraps rather than truncates: a step called "COMO SE ESC…"
                   is one nobody can tell apart from the next. */
                className={`text-[11px] font-semibold uppercase leading-tight tracking-wide ${
                  active ? 'text-ink' : 'text-muted-foreground'
                }`}
              >
                {labelOf(key)}
              </span>
            </button>
            {position < steps.length - 1 && (
              <span
                aria-hidden="true"
                className={`mt-4 h-px flex-1 ${done ? 'bg-brand-yellow' : 'bg-line'}`}
              />
            )}
          </li>
        )
      })}
    </ol>
  )
}

/** One choice in a guided list — a row, with the state on the left. */
function Choice({
  checked,
  label,
  hint,
  onSelect,
}: {
  checked: boolean
  label: string
  hint?: string
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      onClick={onSelect}
      className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition ${
        checked
          ? 'border-brand-blue bg-sky-soft'
          : 'border-line bg-white hover:border-brand-blue/40 hover:bg-cream'
      }`}
    >
      <span
        aria-hidden="true"
        className={`grid size-4 shrink-0 place-items-center rounded-full border-2 ${
          checked ? 'border-brand-blue' : 'border-slate-300'
        }`}
      >
        {checked && <span className="size-2 rounded-full bg-brand-blue" />}
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-sm font-medium text-ink">{label}</span>
        {hint && <span className="truncate text-xs text-muted-foreground">{hint}</span>}
      </span>
    </button>
  )
}

/**
 * The composer for a send written by hand — one guided form, exactly like the
 * enrollment form: the sections stacked in the order the mistakes happen (who
 * it reaches, what it says, a test to a real inbox, and only then the
 * approval), all of them on screen at once.
 *
 * Not a wizard. Four screens behind Next buttons hid the thing somebody most
 * needs while approving a send: everything they just decided, in one look.
 * Each answer is still picked from what exists rather than typed — a segment
 * typed by hand is a segment that matches nobody — and the chosen one is shown
 * back as a card you can swap.
 *
 * Two rules are wired rather than written on a sign:
 *
 * - **The test stops counting the moment the content changes.** Editing the
 *   subject, the message or the file clears it, so nobody ever approves a
 *   message that was edited after being checked (`docs/ROADMAP.md` fase 5).
 * - **Everyone is not a segment somebody reaches alone.** A send to the whole
 *   register needs a second approval, and the button stays shut until that
 *   exists — an empty confirmation would be worse than no confirmation.
 *
 * Nothing is saved: this is the mockup, and the send ends queued because the
 * outbox is what delivers, never this screen (CLAUDE.md §5).
 */
export function NewEmailForm({
  allCount,
  courses,
  classGroups,
  statuses,
}: {
  allCount: number
  courses: { name: string; count: number }[]
  classGroups: { id: string; label: string; count: number }[]
  statuses: { status: EnrollmentStatus; count: number }[]
}) {
  const t = useTranslations('bo')

  const [openStep, setOpenStep] = useState('segment')
  const [kind, setKind] = useState<SegmentKind>('course')
  const [courseName, setCourseName] = useState<string | null>(null)
  const [classGroupId, setClassGroupId] = useState<string | null>(null)
  const [status, setStatus] = useState<EnrollmentStatus | null>(null)
  const [query, setQuery] = useState('')

  const [mode, setMode] = useState<ContentMode>('write')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [html, setHtml] = useState<{ name: string; source: string } | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  /** Cleared by any edit to the content — that is the whole point of it. */
  const [testSent, setTestSent] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [sent, setSent] = useState<number | null>(null)

  const course = courses.find((item) => item.name === courseName) ?? null
  const classGroup = classGroups.find((item) => item.id === classGroupId) ?? null
  const statusRow = statuses.find((item) => item.status === status) ?? null

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return { courses: [], classGroups: [] }
    return {
      courses: courses
        .filter((item) => item.name.toLowerCase().includes(needle))
        .slice(0, MAX_MATCHES),
      classGroups: classGroups
        .filter((item) => item.label.toLowerCase().includes(needle))
        .slice(0, MAX_MATCHES),
    }
  }, [courses, classGroups, query])

  const recipients =
    kind === 'all'
      ? allCount
      : kind === 'course'
        ? (course?.count ?? null)
        : kind === 'class_group'
          ? (classGroup?.count ?? null)
          : (statusRow?.count ?? null)

  const segmentLabel =
    kind === 'all'
      ? t('new_email.segment_all')
      : kind === 'course'
        ? (course?.name ?? '')
        : kind === 'class_group'
          ? (classGroup?.label ?? '')
          : statusRow
            ? t(`enrollment_status.${statusRow.status}`)
            : ''

  /* A send to the whole register is the one nobody signs off alone. */
  const needsSecondApproval = kind === 'all'

  function editContent(next: () => void) {
    next()
    setTestSent(false)
    setConfirmed(false)
    setError(null)
  }

  function pickKind(next: SegmentKind) {
    setKind(next)
    setQuery('')
    setError(null)
  }

  function readFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    if (!/\.html?$/i.test(file.name)) {
      setError(t('new_email.html_error_type'))
      return
    }
    const reader = new FileReader()
    reader.onload = () =>
      editContent(() => setHtml({ name: file.name, source: String(reader.result) }))
    reader.readAsText(file)
  }

  /** What the step being left has to have, before it may be left. */
  function missingHere(): string | null {
    /* On the first step the group is only half chosen — which one it is comes
       next. Only "toda a base" can be judged here, because it answers both. */
    if (step === 'segment') {
      return needsValue || (recipients ?? 0) > 0
        ? null
        : t('new_email.error_recipients')
    }
    if (step === 'value') {
      return (recipients ?? 0) > 0 ? null : t('new_email.error_recipients')
    }
    if (step === 'content') {
      if (subject.trim().length === 0) return t('new_email.error_subject')
      if (mode === 'write' && body.trim().length === 0) {
        return t('new_email.error_body')
      }
      if (mode === 'html' && html === null) return t('new_email.error_html')
      return null
    }
    if (step === 'test') return testSent ? null : t('new_email.error_test')
    return confirmed ? null : t('new_email.error_confirm')
  }

  function go(key: string) {
    setError(null)
    setOpenStep(key)
  }

  function advance() {
    const missing = missingHere()
    if (missing) {
      setError(missing)
      return
    }
    go(stepKeys[current + 1])
  }

  function send() {
    const missing = missingHere()
    if (missing) {
      setError(missing)
      return
    }
    setError(null)
    setSent(recipients ?? 0)
  }

  function reset() {
    setSent(null)
    setOpenStep('segment')
    setSubject('')
    setBody('')
    setHtml(null)
    setTestSent(false)
    setConfirmed(false)
  }

  if (sent !== null) {
    return (
      <div className="flex flex-col gap-4">
        <EmptyState
          icon="check"
          title={t('new_email.sent_title')}
          body={t('new_email.sent_body', { count: sent })}
        />
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={reset} className={primaryButtonClass}>
            <BoIcon name="plus" size={16} />
            {t('new_email.sent_again')}
          </button>
          <Link href="/backoffice/emails" className={ghostButtonClass}>
            {t('new_email.back')}
          </Link>
        </div>
      </div>
    )
  }

  const needsValue = kind !== 'all'

  /* The order on screen. "Qual" is only a step when the segment asks for a
     value, and everything after it moves up a number when it does not. */
  const stepKeys = [
    'segment',
    ...(needsValue ? ['value'] : []),
    'content',
    'test',
    'review',
  ]
  /* Picking "toda a base" removes the step somebody may be standing on — the
     form falls back to the one before it rather than going blank. */
  const current = Math.max(0, stepKeys.indexOf(openStep))
  const step = stepKeys[current]
  const stepLabel = (key: string) =>
    key === 'segment'
      ? t('new_email.segment_step')
      : key === 'value'
        ? t('new_email.value_step')
        : key === 'content'
          ? t('new_email.content_step')
          : key === 'test'
            ? t('new_email.step_test')
            : t('new_email.step_review')

  const chosen =
    kind === 'course' ? course : kind === 'class_group' ? classGroup : statusRow

  return (
    <div className="flex flex-col gap-4">
      <Card className="p-5">
        <Stepper
          steps={stepKeys}
          current={current}
          labelOf={stepLabel}
          onPick={go}
        />

        <div className="mt-5 border-t border-line pt-5">
        {step === 'segment' && (
          <>
              <div role="radiogroup" className="flex flex-col gap-2 sm:max-w-md">
                {KINDS.map((value) => (
                  <Choice
                    key={value}
                    checked={kind === value}
                    label={t(`new_email.segment_${value}`)}
                    hint={
                      value === 'all'
                        ? t('new_email.recipients_count', { count: allCount })
                        : undefined
                    }
                    onSelect={() => pickKind(value)}
                  />
                ))}
              </div>

          <p className="mt-4 flex items-start gap-2 rounded-lg border border-dashed border-line bg-sky-soft px-3 py-2 text-xs text-muted-foreground">
            <BoIcon name="shield" size={14} className="mt-0.5 shrink-0" />
            {t('new_email.recipients_note')}
          </p>
          </>
        )}

            {step === 'value' && (
              <>

                {kind === 'enrollment_status' ? (
                  <div role="radiogroup" className="flex flex-col gap-2 sm:max-w-md">
                    {statuses.map((item) => (
                      <Choice
                        key={item.status}
                        checked={status === item.status}
                        label={t(`enrollment_status.${item.status}`)}
                        hint={t('new_email.recipients_count', { count: item.count })}
                        onSelect={() => {
                          setStatus(item.status)
                          setError(null)
                        }}
                      />
                    ))}
                  </div>
                ) : chosen ? (
                  /* The choice, shown back as what it is — with the way out of
                     it right next to it, like the student on the enrollment
                     form. */
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-sky-soft px-3 py-2.5 sm:max-w-md">
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-sm font-semibold text-ink">
                        {kind === 'course' ? course?.name : classGroup?.label}
                      </span>
                      <span className="truncate text-xs text-muted-foreground">
                        {t('new_email.recipients_count', {
                          count: kind === 'course' ? course!.count : classGroup!.count,
                        })}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setCourseName(null)
                        setClassGroupId(null)
                        setQuery('')
                      }}
                      className="text-xs font-semibold text-brand-blue transition hover:text-brand-blue-deep"
                    >
                      {t('new_email.change')}
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    <label className="flex flex-col gap-1 sm:max-w-md">
                      <span className={labelClass}>
                        {t(
                          kind === 'course'
                            ? 'new_email.pick_course'
                            : 'new_email.pick_class_group',
                        )}
                        <RequiredMark label={t('common.required')} />
                      </span>
                      <span className="relative">
                        <BoIcon
                          name="search"
                          size={16}
                          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                        />
                        <input
                          type="search"
                          value={query}
                          onChange={(event) => setQuery(event.target.value)}
                          placeholder={t(
                            kind === 'course'
                              ? 'new_email.search_course'
                              : 'new_email.search_class_group',
                          )}
                          className={`${fieldClass} pl-9`}
                        />
                      </span>
                    </label>

                    {query.trim() !== '' &&
                      ((kind === 'course' ? matches.courses : matches.classGroups)
                        .length === 0 ? (
                        <p className="text-xs text-muted-foreground">
                          {t('new_email.no_matches')}
                        </p>
                      ) : (
                        <ul className="flex flex-col overflow-hidden rounded-lg border border-line sm:max-w-md">
                          {kind === 'course'
                            ? matches.courses.map((item) => (
                                <li key={item.name}>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setCourseName(item.name)
                                      setError(null)
                                    }}
                                    className="flex w-full items-center justify-between gap-3 border-b border-line/70 px-3 py-2 text-left transition last:border-b-0 hover:bg-sky-soft"
                                  >
                                    <span className="truncate text-sm font-medium text-ink">
                                      {item.name}
                                    </span>
                                    <span className="shrink-0 text-xs text-muted-foreground">
                                      {t('new_email.recipients_count', {
                                        count: item.count,
                                      })}
                                    </span>
                                  </button>
                                </li>
                              ))
                            : matches.classGroups.map((item) => (
                                <li key={item.id}>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setClassGroupId(item.id)
                                      setError(null)
                                    }}
                                    className="flex w-full items-center justify-between gap-3 border-b border-line/70 px-3 py-2 text-left transition last:border-b-0 hover:bg-sky-soft"
                                  >
                                    <span className="truncate text-sm font-medium text-ink">
                                      {item.label}
                                    </span>
                                    <span className="shrink-0 text-xs text-muted-foreground">
                                      {t('new_email.recipients_count', {
                                        count: item.count,
                                      })}
                                    </span>
                                  </button>
                                </li>
                              ))}
                        </ul>
                      ))}
                  </div>
                )}
              </>
            )}

        {/* What it says */}
        {step === 'content' && (
          <>
              <div role="radiogroup" className="flex flex-col gap-2 sm:max-w-md">
                <Choice
                  checked={mode === 'write'}
                  label={t('new_email.content_mode_write')}
                  onSelect={() => editContent(() => setMode('write'))}
                />
                <Choice
                  checked={mode === 'html'}
                  label={t('new_email.content_mode_html')}
                  onSelect={() => editContent(() => setMode('html'))}
                />
              </div>

            <div className="mt-4 flex flex-col gap-4">
              <label className="flex flex-col gap-1.5">
                <span className={labelClass}>
                  {t('new_email.subject_label')}
                  <RequiredMark label={t('common.required')} />
                </span>
                <input
                  type="text"
                  value={subject}
                  onChange={(event) =>
                    editContent(() => setSubject(event.target.value))
                  }
                  placeholder={t('new_email.subject_placeholder')}
                  className={fieldClass}
                />
              </label>

              {mode === 'write' ? (
                <>
                  <label className="flex flex-col gap-1.5">
                    <span className={labelClass}>
                      {t('new_email.body_label')}
                      <RequiredMark label={t('common.required')} />
                    </span>
                    <textarea
                      rows={9}
                      value={body}
                      onChange={(event) =>
                        editContent(() => setBody(event.target.value))
                      }
                      placeholder={t('new_email.body_placeholder')}
                      className={`${fieldClass} resize-y leading-relaxed`}
                    />
                  </label>
                  <p className="flex items-start gap-2 text-xs text-muted-foreground">
                    <BoIcon name="alert" size={14} className="mt-0.5 shrink-0" />
                    {t('new_email.content_note')}
                  </p>
                </>
              ) : (
                <>
                  <div className="flex flex-col gap-1.5">
                    <span className={labelClass}>
                      {t('new_email.html_label')}
                      <RequiredMark label={t('common.required')} />
                    </span>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => fileInput.current?.click()}
                        className={ghostButtonClass}
                      >
                        <BoIcon name="download" size={16} className="rotate-180" />
                        {t('new_email.html_choose')}
                      </button>
                      <span className="text-xs text-muted-foreground">
                        {html?.name ?? t('new_email.html_none')}
                      </span>
                    </div>
                    <input
                      ref={fileInput}
                      type="file"
                      accept=".html,.htm,text/html"
                      onChange={readFile}
                      className="hidden"
                    />
                  </div>

                  {html && (
                    <div className="flex flex-col gap-1.5">
                      <span className={labelClass}>{t('new_email.html_preview')}</span>
                      {/* Sandboxed with nothing allowed back in: the file comes
                          from outside, and a preview that runs its scripts would
                          be running them inside the panel, with the reader's
                          session (CLAUDE.md §8). */}
                      <iframe
                        title={t('new_email.html_preview')}
                        sandbox=""
                        srcDoc={html.source}
                        className="h-80 w-full rounded-lg border border-line bg-white"
                      />
                    </div>
                  )}

                  <p className="flex items-start gap-2 text-xs text-muted-foreground">
                    <BoIcon name="alert" size={14} className="mt-0.5 shrink-0" />
                    {t('new_email.html_note')}
                  </p>
                </>
              )}
            </div>
          </>
        )}

        {/* A test to a real inbox, before anybody approves anything */}
        {step === 'test' && (
          <div className="flex flex-col gap-4">
            <ProofSend
              onSent={(count) => {
                setError(null)
                setTestSent(true)
                setToast(t('emails.test_toast', { count }))
              }}
            />
            <p
              className={`flex items-start gap-2 text-xs font-medium ${
                testSent ? 'text-emerald-700' : 'text-amber-700'
              }`}
            >
              <BoIcon
                name={testSent ? 'check' : 'clock'}
                size={14}
                className="mt-0.5 shrink-0"
              />
              {t(testSent ? 'new_email.test_ok' : 'new_email.test_pending')}
            </p>
          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <BoIcon name="alert" size={14} className="mt-0.5 shrink-0" />
            {t('new_email.test_note')}
          </p>
          </div>
        )}

        {/* The approval. No summary above it: everything it would repeat is
            still on this page, a screen up. */}
        {step === 'review' && (
          <div className="flex flex-col gap-4">
            {/* The summary is here because the steps behind it are off screen:
                nobody approves a mass send from memory. */}
            <dl className="flex flex-col gap-3">
              <div>
                <dt className={labelClass}>{t('new_email.review_recipients')}</dt>
                <dd className="mt-0.5 text-sm font-semibold text-ink">
                  {`${segmentLabel} · ${t('new_email.recipients_count', { count: recipients ?? 0 })}`}
                </dd>
              </div>
              <div>
                <dt className={labelClass}>{t('new_email.review_subject')}</dt>
                <dd className="mt-0.5 text-sm font-semibold text-ink">{subject}</dd>
              </div>
              <div>
                <dt className={labelClass}>
                  {t(mode === 'html' ? 'new_email.review_html' : 'new_email.review_body')}
                </dt>
                {mode === 'html' && html ? (
                  <dd className="mt-1 flex flex-col gap-2">
                    <span className="text-sm font-semibold text-ink">{html.name}</span>
                    <iframe
                      title={t('new_email.html_preview')}
                      sandbox=""
                      srcDoc={html.source}
                      className="h-64 w-full rounded-lg border border-line bg-white"
                    />
                  </dd>
                ) : (
                  <dd className="mt-1 whitespace-pre-wrap rounded-lg border border-line bg-sky-soft px-3 py-2 text-sm leading-relaxed text-ink">
                    {body}
                  </dd>
                )}
              </div>
            </dl>

            <label className="flex items-start gap-2 text-sm text-ink">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(event) => {
                  setConfirmed(event.target.checked)
                  setError(null)
                }}
                className="mt-0.5 size-4 accent-brand-blue"
              />
              {t('new_email.confirm_label')}
            </label>

            {needsSecondApproval && (
              <p className="flex items-start gap-2 rounded-lg border border-dashed border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                <BoIcon name="alert" size={14} className="mt-0.5 shrink-0" />
                {t('new_email.double_approval')}
              </p>
            )}

            <p className="flex items-start gap-2 text-xs text-muted-foreground">
              <BoIcon name="clock" size={14} className="mt-0.5 shrink-0" />
              {t('new_email.cooldown_note')}
            </p>
          </div>
        )}
        </div>

        {error && <p className="mt-4 text-xs font-medium text-red-600">{error}</p>}

        <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-line pt-4">
          {current > 0 && (
            <button
              type="button"
              onClick={() => go(stepKeys[current - 1])}
              className={ghostButtonClass}
            >
              <BoIcon name="arrow-left" size={16} />
              {t('new_email.prev')}
            </button>
          )}
          {step === 'review' ? (
            <button
              type="button"
              onClick={send}
              disabled={needsSecondApproval}
              className={primaryButtonClass}
            >
              <BoIcon name="email" size={16} />
              {t('new_email.send')}
            </button>
          ) : (
            <button type="button" onClick={advance} className={primaryButtonClass}>
              {t('new_email.next')}
              <BoIcon name="chevron-right" size={16} />
            </button>
          )}
          <span className="ml-auto text-xs text-muted-foreground">
            {t('new_email.step_of', { step: current + 1, total: stepKeys.length })}
          </span>
        </div>
      </Card>

      <Toast message={toast} onDismiss={() => setToast(null)} />
    </div>
  )
}
