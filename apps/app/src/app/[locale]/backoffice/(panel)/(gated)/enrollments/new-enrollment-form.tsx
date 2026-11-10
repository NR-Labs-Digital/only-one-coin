'use client'

import { useEffect, useRef, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import type { NationalIdType, PaymentMethod, WeeklySlotItem } from '@/lib/backoffice/types'
import { slotsLabel } from '@/lib/backoffice/schedule'
import { formatFileSize, formatMoney, type Locale } from '@/lib/format'
import { formatPaymentMethod } from '@/lib/payment-method'
import {
  MANUAL_RECEIPT_ACCEPT,
  MANUAL_RECEIPT_MAX_BYTES,
  MANUAL_RECEIPT_TYPES,
  uploadManualReceipt,
} from '@/lib/backoffice/manual-receipt-upload'
import {
  Card,
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
 * (GET /api/v1/students/search), which refuses to turn a search box into a
 * directory-enumeration primitive. */
const MIN_QUERY_LENGTH = 2

/** Debounce so every keystroke doesn't fire its own request. */
const SEARCH_DEBOUNCE_MS = 250

export interface StudentSearchResult {
  id: string
  firstName: string
  lastName: string
  nationalIdType: NationalIdType
  nationalId: string
}

/**
 * `GET /api/v1/students/search` answers a short, capped match list — the
 * picker's own route since the directory moved to server-side paging
 * (OOC-76). It still finds a student whose seat is under review.
 */
interface StudentSearchPage {
  items: StudentSearchResult[]
}

const EMPTY_PAGE: StudentSearchPage = { items: [] }

interface OpenClassGroup {
  id: string
  courseId: string
  courseName: string
  academicPeriodName: string
  /** Legacy free text — only seed rows carry it; the panel writes `slots`. */
  schedule: string
  slots: WeeklySlotItem[]
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
 * `apps/api` (GET /api/v1/students/search, GET /api/v1/class-groups) — teacher and
 * language aren't modeled on a class group yet (no teachers bounded context
 * built), so this form doesn't show or send them.
 */
export function NewEnrollmentForm({
  onCancel,
  onCreate,
  initialStudent = null,
  initialClassGroupId = null,
}: {
  onCancel: () => void
  /** The seat was written. The caller re-reads the ledger from the server. */
  onCreate: () => void
  /**
   * Preselection from a link (the waitlist's "enroll the first in line").
   * It only fills the two pickers: the price still comes from the open class
   * group list the server sends, and everything else is asked as usual.
   */
  initialStudent?: StudentSearchResult | null
  initialClassGroupId?: string | null
}) {
  const t = useTranslations('bo')
  const locale = useLocale() as Locale

  const [studentQuery, setStudentQuery] = useState('')
  const [matches, setMatches] = useState<StudentSearchResult[]>([])
  const [selectedStudent, setSelectedStudent] = useState<StudentSearchResult | null>(initialStudent)

  const [openGroups, setOpenGroups] = useState<OpenClassGroup[]>([])
  const [groupsLoaded, setGroupsLoaded] = useState(false)
  const [classGroupId, setClassGroupId] = useState('')

  const [method, setMethod] = useState<PaymentMethod>('yape')
  const [methodDetail, setMethodDetail] = useState('')
  const [operationNumber, setOperationNumber] = useState('')
  // The receipt is mandatory (OOC-146): the file goes up the same OCR ladder
  // as the checkout's. Once uploaded, its id is kept for the picked file, so
  // a submit refused for another reason (an operation number already used)
  // does not upload the same image twice.
  const receiptInput = useRef<HTMLInputElement>(null)
  const [receiptFile, setReceiptFile] = useState<File | null>(null)
  const [receiptUploadId, setReceiptUploadId] = useState<string | null>(null)
  const [receiptFileError, setReceiptFileError] = useState<'type' | 'size' | null>(null)
  const [pending, setPending] = useState(false)
  // A refused operation number is its own message: retrying the same number
  // gets the same answer, so "try again" would be the wrong advice (OOC-22).
  const [submitError, setSubmitError] = useState<
    'failed' | 'operation_number_used' | 'receipt_upload_failed' | null
  >(null)

  function pickReceipt(picked: File | null) {
    if (!picked) return
    if (!MANUAL_RECEIPT_TYPES.has(picked.type)) {
      setReceiptFileError('type')
      return
    }
    if (picked.size > MANUAL_RECEIPT_MAX_BYTES) {
      setReceiptFileError('size')
      return
    }
    setReceiptFileError(null)
    setReceiptFile(picked)
    setReceiptUploadId(null)
  }

  function dropReceipt() {
    if (receiptInput.current) receiptInput.current.value = ''
    setReceiptFile(null)
    setReceiptUploadId(null)
  }

  useEffect(() => {
    let cancelled = false

    fetch('/api/v1/class-groups')
      .then((response) => (response.ok ? (response.json() as Promise<OpenClassGroup[]>) : []))
      .then((data) => {
        if (cancelled) return
        setOpenGroups(data)
        // A preselected class group that is not open for sale (no seat yet,
        // closed window, draft) is ignored — never forced into the picker.
        if (initialClassGroupId && data.some((item) => item.id === initialClassGroupId)) {
          setClassGroupId(initialClassGroupId)
        }
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
  }, [initialClassGroupId])

  useEffect(() => {
    const query = studentQuery.trim()
    if (query.length < MIN_QUERY_LENGTH) {
      setMatches([])
      return
    }

    let cancelled = false
    const timeout = window.setTimeout(() => {
      fetch(`/api/v1/students/search?q=${encodeURIComponent(query)}`)
        .then((response) =>
          response.ok ? (response.json() as Promise<StudentSearchPage>) : EMPTY_PAGE,
        )
        .then((page) => {
          // Defensive: the cast above is a promise, not a proof. Reading a
          // shape the API no longer sends is exactly what broke this picker
          // once — a wrong answer must degrade to "no matches", never to a
          // `.map` on something that isn't a list.
          if (!cancelled) setMatches(Array.isArray(page?.items) ? page.items : [])
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

  /** The panel writes `slots`; only legacy seed rows still carry text alone. */
  const scheduleOf = (item: OpenClassGroup) =>
    item.slots.length > 0 ? slotsLabel(item.slots, t) : item.schedule

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
    receiptFile === null ||
    (detailNeeded && methodDetail.trim() === '')
  const ready = !missing && !pending

  async function submit() {
    if (!ready || !selectedStudent || !group || !receiptFile) return
    setPending(true)
    setSubmitError(null)

    try {
      let uploadId = receiptUploadId
      if (uploadId === null) {
        const uploaded = await uploadManualReceipt(receiptFile)
        if (!uploaded.ok) {
          setSubmitError('receipt_upload_failed')
          return
        }
        uploadId = uploaded.receiptUploadId
        setReceiptUploadId(uploadId)
      }

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
          receiptUploadId: uploadId,
        }),
      })

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { reason?: string } | null
        // A receipt the API no longer takes (swept, or attached by a double
        // submit) is uploaded again on the next try.
        if (body?.reason === 'enrollment.receipt_not_ready') setReceiptUploadId(null)
        setSubmitError(
          body?.reason === 'enrollment.operation_number_already_used' ? 'operation_number_used' : 'failed',
        )
        return
      }

      /* The seat is written; what it looks like on the ledger is the ledger's
         answer, not this form's. It used to assemble the row here out of what
         the picker happened to hold — which meant a fabricated code, an empty
         teacher and a null language sitting next to rows read from Postgres,
         and the whole thing gone on reload. The caller re-reads instead. */
      onCreate()
    } catch {
      setSubmitError('failed')
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
                    {`${item.courseName} — ${scheduleOf(item)}`}
                  </option>
                ))}
              </select>
            </label>

            {group && (
              <dl className="grid grid-cols-1 gap-x-4 gap-y-2 self-end rounded-lg border border-line bg-sky-soft px-3 py-2.5 @md/page:grid-cols-2">
                <Summary
                  label={t('new_enrollment.field_schedule')}
                  value={scheduleOf(group)}
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

          {/* Mandatory (OOC-146). The image goes straight to the bucket on a
              signed POST and never through the app (CLAUDE.md §6); the upload
              happens on submit, so a form abandoned halfway leaves nothing. */}
          <div className="flex flex-col gap-1">
            <span className={labelClass}>
              {t('new_enrollment.attach_receipt')}
              <RequiredMark label={t('common.required')} />
            </span>
            <input
              ref={receiptInput}
              type="file"
              accept={MANUAL_RECEIPT_ACCEPT}
              className="sr-only"
              aria-label={t('new_enrollment.attach_receipt')}
              onChange={(event) => pickReceipt(event.target.files?.[0] ?? null)}
            />
            {receiptFile ? (
              <div className="flex min-h-tap items-center gap-2 rounded-lg border border-brand-blue bg-sky px-3 py-2">
                <BoIcon name="doc" size={16} className="shrink-0 text-brand-blue" />
                <span className="flex min-w-0 flex-col leading-tight">
                  <span className="truncate text-sm font-semibold text-ink">{receiptFile.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {formatFileSize(receiptFile.size, locale)}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={dropReceipt}
                  disabled={pending}
                  aria-label={t('new_enrollment.receipt_remove')}
                  className="ml-auto shrink-0 rounded-lg p-1.5 text-muted-foreground transition hover:bg-white hover:text-ink disabled:opacity-60"
                >
                  <BoIcon name="close" size={16} />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => receiptInput.current?.click()}
                className="inline-flex min-h-tap items-center justify-center gap-1.5 rounded-lg border border-dashed border-line bg-white px-3 py-2 text-sm font-semibold text-muted-foreground transition hover:text-ink"
              >
                <BoIcon name="doc" size={16} />
                {t('new_enrollment.receipt_pick')}
              </button>
            )}
            {receiptFileError && (
              <span role="alert" className="text-xs text-red-700">
                {t(receiptFileError === 'type' ? 'new_enrollment.receipt_error_type' : 'new_enrollment.receipt_error_size')}
              </span>
            )}
          </div>
        </AutoGrid>

        <p className="mt-3 flex items-start gap-2 rounded-lg border border-dashed border-line bg-sky-soft px-3 py-2 text-xs text-muted-foreground">
          <BoIcon name="shield" size={14} className="mt-0.5 shrink-0" />
          {t('new_enrollment.notice_under_review')}
        </p>
      </section>

      <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-line pt-4">
        <button
          type="button"
          disabled={!ready}
          onClick={() => void submit()}
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
            {submitError === 'operation_number_used'
              ? t('new_enrollment.operation_number_used')
              : submitError === 'receipt_upload_failed'
                ? t('new_enrollment.receipt_upload_error')
                : t('new_enrollment.submit_error')}
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
