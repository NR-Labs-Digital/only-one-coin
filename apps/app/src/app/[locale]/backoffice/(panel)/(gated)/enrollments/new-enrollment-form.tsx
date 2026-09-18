'use client'

import { useEffect, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import type { EnrollmentRow, NationalIdType, PaymentMethod } from '@/lib/backoffice/types'
import { formatMoney, type Locale } from '@/lib/format'
import { formatPaymentMethod } from '@/lib/payment-method'
import {
  Card,
  OptionalMark,
  RequiredMark,
  StatusBadge,
} from '@/components/backoffice/ui'
import { BoIcon } from '@/components/backoffice/icons'
import { AutoGrid } from '@/components/layout/auto-grid'

const fieldClass =
  'rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink outline-none transition focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/15'

const labelClass =
  'text-xs font-medium uppercase tracking-wide text-muted-foreground'

/**
 * The four rails, and `other` for the deposit that came through none of them —
 * a bank nobody listed, a transfer from abroad. `other` is not a fifth brand:
 * picking it asks for the text that names it, because "other" on a ledger line
 * is a question nobody can answer six months later.
 */
const METHODS: PaymentMethod[] = ['yape', 'plin', 'bcp', 'interbank', 'other']

/** Minimum characters before searching — matches the API's own floor
 * (GET /api/v1/students), which refuses to turn a search box into a
 * directory-enumeration primitive. */
const MIN_QUERY_LENGTH = 2

/** Debounce so every keystroke doesn't fire its own request. */
const SEARCH_DEBOUNCE_MS = 250

interface StudentSearchResult {
  id: string
  firstName: string
  lastName: string
  nationalIdType: NationalIdType
  nationalId: string
}

interface OpenClassGroup {
  id: string
  courseId: string
  courseName: string
  academicPeriodName: string
  schedule: string
  startsOn: string
  capacity: number
  seatsTaken: number
  status: string
  planId: string
  planName: string
  planPriceId: string
  amountCents: number
}

/**
 * Opening an enrollment from the panel — the exception, not the way in. The
 * documented path is the student filling `/enrollment` themselves (CLAUDE.md
 * §1); this covers the sale that closed on WhatsApp and never reached the form.
 *
 * Three things it deliberately does not do:
 *
 * - It does not create a student. It enrolls somebody already on file, found by
 *   name or document. Registering a person carries the guardian consent record
 *   (Ley 29733, CLAUDE.md §8) and that is not a side effect of a seat.
 * - It does not price anything. The amount is the plan price in force, resolved
 *   server-side and shown read-only: there are no discounts, ever (CLAUDE.md
 *   §1), so a field somebody can type into is a field somebody can undercharge
 *   from.
 * - It does not approve money. The seat is reserved and the payment goes in
 *   open — with a receipt attached it enters the same review ladder every other
 *   receipt does (CLAUDE.md §5). Whoever creates an enrollment must not also be
 *   the one who settles it.
 *
 * Student search and the open class group list are both real reads against
 * `apps/api` (GET /api/v1/students, GET /api/v1/class-groups) — teacher and
 * language aren't modeled on a class group yet (no teachers bounded context
 * built), so this form doesn't show or send them.
 */
export function NewEnrollmentForm({
  onCancel,
  onCreate,
}: {
  onCancel: () => void
  onCreate: (enrollment: EnrollmentRow) => void
}) {
  const t = useTranslations('bo')
  const locale = useLocale() as Locale

  const [studentQuery, setStudentQuery] = useState('')
  const [matches, setMatches] = useState<StudentSearchResult[]>([])
  const [selectedStudent, setSelectedStudent] = useState<StudentSearchResult | null>(null)

  const [openGroups, setOpenGroups] = useState<OpenClassGroup[]>([])
  const [groupsLoaded, setGroupsLoaded] = useState(false)
  const [classGroupId, setClassGroupId] = useState('')

  const [method, setMethod] = useState<PaymentMethod>('yape')
  const [methodDetail, setMethodDetail] = useState('')
  const [operationNumber, setOperationNumber] = useState('')
  const [receiptAttached, setReceiptAttached] = useState(false)
  const [pending, setPending] = useState(false)
  const [submitError, setSubmitError] = useState(false)

  useEffect(() => {
    let cancelled = false

    fetch('/api/v1/class-groups')
      .then((response) => (response.ok ? (response.json() as Promise<OpenClassGroup[]>) : []))
      .then((data) => {
        if (!cancelled) setOpenGroups(data)
      })
      .catch(() => {
        if (!cancelled) setOpenGroups([])
      })
      .finally(() => {
        if (!cancelled) setGroupsLoaded(true)
      })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const query = studentQuery.trim()
    if (query.length < MIN_QUERY_LENGTH) {
      setMatches([])
      return
    }

    let cancelled = false
    const timeout = window.setTimeout(() => {
      fetch(`/api/v1/students?q=${encodeURIComponent(query)}`)
        .then((response) => (response.ok ? (response.json() as Promise<StudentSearchResult[]>) : []))
        .then((data) => {
          if (!cancelled) setMatches(data)
        })
        .catch(() => {
          if (!cancelled) setMatches([])
        })
    }, SEARCH_DEBOUNCE_MS)

    return () => {
      cancelled = true
      window.clearTimeout(timeout)
    }
  }, [studentQuery])

  const group = openGroups.find((item) => item.id === classGroupId) ?? null

  /**
   * Everything the form asks for is required, and the button is where that is
   * enforced: a seat opened without the operation number is a payment tesorería
   * cannot match against a bank statement, and it lands in the review queue
   * anyway — one field short of settleable.
   */
  const detailNeeded = method === 'other'
  const missing =
    selectedStudent === null ||
    group === null ||
    operationNumber.trim() === '' ||
    (detailNeeded && methodDetail.trim() === '')
  const ready = !missing && !pending

  async function submit() {
    if (!ready || !selectedStudent || !group) return
    setPending(true)
    setSubmitError(false)

    try {
      const response = await fetch('/api/v1/enrollments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentId: selectedStudent.id,
          classGroupId: group.id,
          planId: group.planId,
          method,
          methodDetail: method === 'other' ? methodDetail.trim() : null,
          operationNumber: operationNumber.trim(),
          receiptAttached,
        }),
      })

      if (!response.ok) {
        setSubmitError(true)
        return
      }

      const created = (await response.json()) as {
        enrollment: { id: string; seatStatus: 'reserved' | 'confirmed' | 'released' }
        payment: { status: 'pending' | 'under_review' | 'approved' | 'rejected' }
      }
      const now = new Date().toISOString()
      onCreate({
        id: created.enrollment.id,
        // apps/api doesn't issue a tracking code yet — same digits-from-id
        // formula the enrollments list's mock uses (mock-data.ts,
        // enrollmentCode), so a row created here reads consistently with the
        // rest of the list until the backend takes over issuing it.
        code: `OOC-${now.slice(0, 4)}-${created.enrollment.id.replace(/\D/g, '').slice(-4).padStart(4, '0')}`,
        studentId: selectedStudent.id,
        studentName: `${selectedStudent.firstName} ${selectedStudent.lastName}`,
        courseName: group.courseName,
        classGroupId: group.id,
        classGroupName: group.schedule,
        // No teachers bounded context yet (docs/ROADMAP.md Sessão 5 deferred
        // it) — nothing honest to put here yet.
        teacherName: '',
        language: null,
        // Always true today (CLAUDE.md §1, "toda aula é online") — not a
        // guess, the one value the business rule allows.
        modality: 'online',
        academicPeriodName: group.academicPeriodName,
        status: 'under_review',
        seatStatus: created.enrollment.seatStatus,
        planName: group.planName,
        planPriceId: group.planPriceId,
        amountCents: group.amountCents,
        currency: 'PEN',
        paymentStatus: created.payment.status,
        paymentMethod: method,
        // The rails name themselves; `other` is only ever as good as the text.
        paymentMethodDetail: method === 'other' ? methodDetail.trim() : null,
        operationNumber: operationNumber.trim(),
        createdAt: now,
        paidAt: null,
        progressPct: null,
      })
    } catch {
      setSubmitError(true)
    } finally {
      setPending(false)
    }
  }

  return (
    <Card className="p-5">
      <p className="mb-1 text-sm font-semibold text-ink">
        {t('new_enrollment.title')}
      </p>
      <p className="mb-4 text-xs text-muted-foreground">
        {t('new_enrollment.subtitle')}
      </p>

      {/* Student */}
      <section className="border-t border-line pt-4">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t('new_enrollment.step_student')}
        </p>

        {selectedStudent ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-sky-soft px-3 py-2.5">
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-sm font-semibold text-ink">
                {`${selectedStudent.firstName} ${selectedStudent.lastName}`}
              </span>
              <span className="truncate text-xs text-muted-foreground">
                {t('students.document', {
                  type: t(`national_id_type.${selectedStudent.nationalIdType}`),
                  number: selectedStudent.nationalId,
                })}
              </span>
            </span>
            <button
              type="button"
              onClick={() => {
                setSelectedStudent(null)
                setStudentQuery('')
              }}
              className="text-xs font-semibold text-brand-blue transition hover:text-brand-blue-deep"
            >
              {t('new_enrollment.change_student')}
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <label className="flex flex-col gap-1 sm:max-w-md">
              <span className={labelClass}>
                {t('new_enrollment.search_student_label')}
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
                  value={studentQuery}
                  onChange={(event) => setStudentQuery(event.target.value)}
                  placeholder={t('new_enrollment.search_student_placeholder')}
                  aria-required="true"
                  className={`${fieldClass} w-full pl-9`}
                />
              </span>
            </label>

            {studentQuery.trim().length >= MIN_QUERY_LENGTH &&
              (matches.length === 0 ? (
                /* The panel does not offer to create the person from here:
                   registering a student carries the consent record, and that is
                   a flow of its own (CLAUDE.md §8). */
                <p className="text-xs text-muted-foreground">
                  {t('new_enrollment.no_students_found')}
                </p>
              ) : (
                <ul className="flex flex-col overflow-hidden rounded-lg border border-line sm:max-w-md">
                  {matches.map((row) => (
                    <li key={row.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedStudent(row)}
                        className="flex w-full flex-col items-start gap-0.5 border-b border-line/70 px-3 py-2 text-left transition last:border-b-0 hover:bg-sky-soft"
                      >
                        <span className="text-sm font-medium text-ink">
                          {`${row.firstName} ${row.lastName}`}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {t('students.document', {
                            type: t(`national_id_type.${row.nationalIdType}`),
                            number: row.nationalId,
                          })}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ))}
          </div>
        )}
      </section>

      {/* Class group */}
      <section className="mt-5 border-t border-line pt-4">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t('new_enrollment.step_class_group')}
        </p>

        {groupsLoaded && openGroups.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {t('new_enrollment.no_open_class_groups')}
          </p>
        ) : (
          <AutoGrid min="18rem" gap="gap-3">
            <label className="flex flex-col gap-1">
              <span className={labelClass}>
                {t('new_enrollment.field_class_group')}
                <RequiredMark label={t('common.required')} />
              </span>
              <select
                value={classGroupId}
                onChange={(event) => setClassGroupId(event.target.value)}
                required
                aria-required="true"
                className={fieldClass}
              >
                <option value="">
                  {t('new_enrollment.class_group_placeholder')}
                </option>
                {openGroups.map((item) => (
                  <option key={item.id} value={item.id}>
                    {`${item.courseName} — ${item.schedule}`}
                  </option>
                ))}
              </select>
            </label>

            {group && (
              <dl className="grid grid-cols-1 gap-x-4 gap-y-2 self-end rounded-lg border border-line bg-sky-soft px-3 py-2.5 @md/page:grid-cols-2">
                <Summary
                  label={t('new_enrollment.field_schedule')}
                  value={group.schedule}
                />
                <Summary
                  label={t('new_enrollment.field_period')}
                  value={group.academicPeriodName}
                />
                <Summary
                  label={t('new_enrollment.seats_left')}
                  value={String(group.capacity - group.seatsTaken)}
                />
              </dl>
            )}
          </AutoGrid>
        )}

        {/* The price, shown and not asked for. */}
        {group && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <StatusBadge
              tone="info"
              dot={false}
              label={`${group.planName} · ${formatMoney(group.amountCents, 'PEN', locale)}`}
            />
            <span className="text-xs text-muted-foreground">
              {t('new_enrollment.price_locked')}
            </span>
          </div>
        )}
      </section>

      {/* Receipt */}
      <section className="mt-5 border-t border-line pt-4">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t('new_enrollment.step_receipt')}
        </p>

        <AutoGrid min="15rem" gap="gap-3">
          <label className="flex flex-col gap-1">
            <span className={labelClass}>
              {t('new_enrollment.field_method')}
              <RequiredMark label={t('common.required')} />
            </span>
            <select
              value={method}
              onChange={(event) => setMethod(event.target.value as PaymentMethod)}
              required
              aria-required="true"
              className={fieldClass}
            >
              {METHODS.map((value) => (
                /* Rail names are proper nouns — never translated
                   (CLAUDE.md §4 glossary); `other` is the one entry that has a
                   word instead of a brand. */
                <option key={value} value={value}>
                  {formatPaymentMethod(value, null, t('new_enrollment.method_other'))}
                </option>
              ))}
            </select>
          </label>

          {/* Only once "other" is picked, and required from that moment: a
              ledger line reading "other" and nothing else is a question
              nobody can answer six months later. */}
          {detailNeeded && (
            <label className="flex flex-col gap-1">
              <span className={labelClass}>
                {t('new_enrollment.field_method_other')}
                <RequiredMark label={t('common.required')} />
              </span>
              <input
                value={methodDetail}
                onChange={(event) => setMethodDetail(event.target.value)}
                placeholder={t('new_enrollment.method_other_placeholder')}
                required
                aria-required="true"
                className={fieldClass}
              />
            </label>
          )}

          <label className="flex flex-col gap-1">
            <span className={labelClass}>
              {t('new_enrollment.field_operation')}
              <RequiredMark label={t('common.required')} />
            </span>
            <input
              value={operationNumber}
              onChange={(event) => setOperationNumber(event.target.value)}
              placeholder={t('new_enrollment.operation_placeholder')}
              required
              aria-required="true"
              className={`${fieldClass} tabular-nums`}
            />
          </label>

          {/* No storage is wired yet; in production the image goes straight to
              the bucket through a signed URL and never through the app
              (CLAUDE.md §5). */}
          <label className="flex flex-col gap-1">
            <span className={labelClass}>
              {t('new_enrollment.attach_receipt')}
              <OptionalMark label={t('common.optional')} />
            </span>
            <button
              type="button"
              onClick={() => setReceiptAttached(!receiptAttached)}
              aria-pressed={receiptAttached}
              className={`inline-flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-semibold transition ${
                receiptAttached
                  ? 'border-brand-blue bg-sky text-brand-blue'
                  : 'border-dashed border-line bg-white text-muted-foreground hover:text-ink'
              }`}
            >
              <BoIcon name={receiptAttached ? 'check' : 'doc'} size={16} />
              {t(
                receiptAttached
                  ? 'new_enrollment.receipt_attached'
                  : 'new_enrollment.receipt_attach',
              )}
            </button>
          </label>
        </AutoGrid>

        <p className="mt-3 flex items-start gap-2 rounded-lg border border-dashed border-line bg-sky-soft px-3 py-2 text-xs text-muted-foreground">
          <BoIcon name="shield" size={14} className="mt-0.5 shrink-0" />
          {t(
            receiptAttached
              ? 'new_enrollment.notice_under_review'
              : 'new_enrollment.notice_pending',
          )}
        </p>
      </section>

      <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-line pt-4">
        <button
          type="button"
          disabled={!ready}
          onClick={submit}
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand-blue px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-brand-blue-deep disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-brand-blue"
        >
          <BoIcon name="check" size={16} />
          {pending ? t('student_file.saving') : t('new_enrollment.create')}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className="rounded-lg border border-line px-3.5 py-2 text-sm font-semibold text-muted-foreground transition hover:text-ink disabled:opacity-60"
        >
          {t('new_enrollment.cancel')}
        </button>
        {/* A button that greys out without saying why reads as broken. */}
        {!ready && !pending && (
          <span className="text-xs text-muted-foreground">
            {t('new_enrollment.missing_fields')}
          </span>
        )}
        {submitError && (
          <span className="text-xs font-medium text-red-600">
            {t('new_enrollment.submit_error')}
          </span>
        )}
      </div>
    </Card>
  )
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="truncate text-xs font-medium text-ink">{value}</dd>
    </div>
  )
}
