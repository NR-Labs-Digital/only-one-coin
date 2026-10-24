'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import type { CatalogErrorKey, CourseRow, PlanDetail } from '@/lib/backoffice/types'
import { catalogWrite, setCatalogEntryOnOffer } from '@/lib/backoffice/catalog-client'
import { isoToLimaDate, limaDateToIso } from '@/lib/backoffice/lima-date'
import { formatDate, formatMoney, type Locale } from '@/lib/format'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { BoIcon } from '@/components/backoffice/icons'
import { CatalogConfirmation, RetireConfirmation } from '@/components/backoffice/retire-confirmation'

const fieldClass =
  'rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink outline-none transition focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/15'

const labelClass = 'text-xs font-medium uppercase tracking-wide text-muted-foreground'

const primaryButtonClass =
  'inline-flex min-h-tap items-center gap-1.5 rounded-lg bg-brand-blue px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-brand-blue-deep disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-brand-blue'

const secondaryButtonClass =
  'inline-flex min-h-tap items-center rounded-lg border border-line px-3.5 py-2 text-sm font-semibold text-muted-foreground transition hover:text-ink'

const dangerButtonClass =
  'inline-flex min-h-tap items-center rounded-lg border border-line px-3.5 py-2 text-sm font-semibold text-red-700 transition hover:border-red-200 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40'

type Notice =
  | { kind: 'created' | 'price_scheduled' | 'restored' }
  | { kind: 'retired'; liveEnrollments: number }
  | { kind: 'error'; error: CatalogErrorKey }

/**
 * A course's plans and the history of each price (OOC-36). Prices are
 * versioned and never edited (CLAUDE.md §5): the only write here for money is
 * "schedule a new price", and the sheet says so where the reader would look
 * for an edit button.
 *
 * Taking a plan off sale is a separate gate from pricing it: whoever opens
 * class groups decides what stops being sold (CLAUDE.md §1, the retire route's
 * roles), the same way they retire a class group. Enrollments already made on
 * it keep their price; the confirmation says how many are still standing.
 */
export function CoursePlansSheet({
  course,
  canManage,
  canRetire,
  onClose,
}: {
  course: CourseRow | null
  canManage: boolean
  /** Retire and restore a plan — master, admin and enrollment_supervisor. */
  canRetire: boolean
  onClose: () => void
}) {
  const t = useTranslations('bo')
  const [plans, setPlans] = useState<PlanDetail[] | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)

  // Only the newest request may write state: a slow answer for a course the
  // user already left must never land under another course's title.
  const currentId = useRef<string | null>(null)
  currentId.current = course?.id ?? null
  const inflight = useRef<AbortController | null>(null)

  const load = useCallback(async (id: string) => {
    inflight.current?.abort()
    const controller = new AbortController()
    inflight.current = controller
    setLoadFailed(false)
    try {
      const response = await fetch(`/api/v1/catalog/courses/${id}`, {
        signal: controller.signal,
      })
      if (!response.ok) throw new Error(String(response.status))
      const body = (await response.json()) as { plans: PlanDetail[] }
      if (inflight.current !== controller) return
      setPlans(body.plans)
    } catch {
      if (controller.signal.aborted || inflight.current !== controller) return
      setLoadFailed(true)
    }
  }, [])

  useEffect(() => {
    setPlans(null)
    setNotice(null)
    if (course) void load(course.id)
    return () => {
      inflight.current?.abort()
      inflight.current = null
    }
  }, [course, load])

  async function changed(next: Notice | null, writtenId: string) {
    // A write that finished after the sheet moved on must not touch the new course.
    if (currentId.current !== writtenId) return
    setNotice(next)
    if (next?.kind !== 'error') await load(writtenId)
  }

  return (
    <Sheet
      open={course !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <SheetContent
        side="right"
        closeLabel={t('plans.close')}
        className="w-full gap-0 overflow-y-auto bg-white p-0 sm:max-w-md"
      >
        {course && (
          <>
            <SheetHeader className="gap-2 border-b border-line p-5 pr-14">
              <SheetTitle className="text-base font-semibold text-ink">
                {t('plans.title')}
              </SheetTitle>
              <SheetDescription>
                {t('plans.subtitle', { course: course.name, language: course.language.name })}
              </SheetDescription>
            </SheetHeader>

            <div className="flex flex-col gap-4 p-5">
              <p className="flex items-start gap-2 rounded-lg border border-dashed border-line bg-sky-soft px-3 py-2 text-xs text-muted-foreground">
                <BoIcon name="alert" size={14} className="mt-0.5 shrink-0" />
                {t('plans.no_edit_rule')}
              </p>

              {notice?.kind === 'error' ? (
                <p role="alert" className="text-sm text-red-700">
                  {t(`catalog_errors.${notice.error}`)}
                </p>
              ) : (
                notice && (
                  <p role="status" className="text-sm text-emerald-700">
                    {notice.kind === 'retired'
                      ? t('plans.retired', { count: notice.liveEnrollments })
                      : t(`plans.${notice.kind}`)}
                  </p>
                )
              )}

              {loadFailed && (
                <p role="alert" className="text-sm text-red-700">
                  {t('plans.load_error')}
                </p>
              )}

              {plans && plans.length === 0 && (
                <p className="text-sm text-muted-foreground">{t('plans.empty')}</p>
              )}

              {plans?.map((plan) => (
                <PlanCard
                  key={plan.id}
                  plan={plan}
                  canManage={canManage}
                  canRetire={canRetire}
                  onChanged={(next) => changed(next, course.id)}
                />
              ))}

              {canManage && plans && (
                <NewPlanForm courseId={course.id} onChanged={(next) => changed(next, course.id)} />
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}

function PlanCard({
  plan,
  canManage,
  canRetire,
  onChanged,
}: {
  plan: PlanDetail
  canManage: boolean
  canRetire: boolean
  onChanged: (notice: Notice | null) => Promise<void>
}) {
  const t = useTranslations('bo')
  const locale = useLocale() as Locale
  const [pricing, setPricing] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(plan.name)
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState<'retire' | 'restore' | null>(null)

  const now = Date.now()
  const current = plan.prices.find((price) => price.id === plan.currentPriceId)
  const scheduled = plan.prices.filter((price) => new Date(price.validFrom).getTime() > now)
  const history = plan.prices.filter(
    (price) => price.id !== plan.currentPriceId && new Date(price.validFrom).getTime() <= now,
  )

  async function rename() {
    setBusy(true)
    const result = await catalogWrite(`/plans/${plan.id}`, 'PATCH', { name: name.trim() })
    setBusy(false)
    if (!result.ok) {
      await onChanged({ kind: 'error', error: result.error })
      return
    }
    setRenaming(false)
    await onChanged(null)
  }

  async function setOnSale(verb: 'retire' | 'restore') {
    setBusy(true)
    const result = await setCatalogEntryOnOffer('plan', plan.id, verb)
    setBusy(false)
    if (!result.ok) {
      await onChanged({ kind: 'error', error: result.error })
      return
    }
    setConfirming(null)
    await onChanged(
      verb === 'retire'
        ? { kind: 'retired', liveEnrollments: result.data.liveEnrollments }
        : { kind: 'restored' },
    )
  }

  async function schedule(amountCents: number, validFrom: string | undefined) {
    setBusy(true)
    const result = await catalogWrite(`/plans/${plan.id}/prices`, 'POST', {
      amountCents,
      validFrom,
    })
    setBusy(false)
    if (!result.ok) {
      await onChanged({ kind: 'error', error: result.error })
      return
    }
    setPricing(false)
    await onChanged({ kind: 'price_scheduled' })
  }

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-line p-4">
      <div className="flex items-center gap-2">
        {renaming ? (
          <label className="flex flex-1 flex-col gap-1">
            <span className="sr-only">{t('plans.plan_name')}</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              className={fieldClass}
            />
          </label>
        ) : (
          <h3 className="flex-1 text-sm font-semibold text-ink">{plan.name}</h3>
        )}
        {!plan.active && (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-muted-foreground">
            {t('plans.inactive')}
          </span>
        )}
      </div>

      {current ? (
        <div>
          <p className="text-lg font-semibold tabular-nums text-ink">
            {formatMoney(current.amountCents, 'PEN', locale)}
          </p>
          <p className="text-xs text-muted-foreground">
            {t('plans.valid_from', { date: formatDate(current.validFrom, locale) })}
          </p>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{t('plans.no_current')}</p>
      )}

      {scheduled.length > 0 && (
        <ul className="flex flex-col gap-1 text-sm">
          {scheduled.map((price) => (
            <li key={price.id} className="flex items-baseline justify-between gap-2">
              <span className="text-muted-foreground">
                {t('plans.scheduled', { date: formatDate(price.validFrom, locale) })}
              </span>
              <span className="font-semibold tabular-nums text-ink">
                {formatMoney(price.amountCents, 'PEN', locale)}
              </span>
            </li>
          ))}
        </ul>
      )}

      {history.length > 0 && (
        <div>
          <p className={labelClass}>{t('plans.history')}</p>
          <ul className="mt-1 flex flex-col gap-1 text-sm">
            {history.map((price) => (
              <li key={price.id} className="flex items-baseline justify-between gap-2">
                <span className="text-muted-foreground">
                  {formatDate(price.validFrom, locale)}
                </span>
                <span className="tabular-nums text-muted-foreground">
                  {formatMoney(price.amountCents, 'PEN', locale)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {canManage && (
        <div className="flex flex-wrap items-center gap-2">
          {renaming ? (
            <>
              <button
                type="button"
                disabled={busy || name.trim().length === 0}
                onClick={() => void rename()}
                className={primaryButtonClass}
              >
                <BoIcon name="check" size={16} />
                {t('plans.save')}
              </button>
              <button
                type="button"
                onClick={() => {
                  setRenaming(false)
                  setName(plan.name)
                }}
                className={secondaryButtonClass}
              >
                {t('plans.cancel')}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setPricing((open) => !open)}
                aria-expanded={pricing}
                className={secondaryButtonClass}
              >
                {t('plans.new_price')}
              </button>
              <button
                type="button"
                onClick={() => setRenaming(true)}
                className={secondaryButtonClass}
              >
                {t('plans.rename')}
              </button>
            </>
          )}
        </div>
      )}

      {canRetire && !renaming && confirming === null && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => setConfirming(plan.active ? 'retire' : 'restore')}
            className={plan.active ? dangerButtonClass : secondaryButtonClass}
          >
            {t(plan.active ? 'plans.retire' : 'plans.restore')}
          </button>
        </div>
      )}

      {confirming === 'retire' && (
        <RetireConfirmation
          kind="plan"
          id={plan.id}
          text={t('plans.confirm_retire')}
          pending={busy}
          onConfirm={() => void setOnSale('retire')}
          onCancel={() => setConfirming(null)}
        />
      )}

      {confirming === 'restore' && (
        <CatalogConfirmation
          text={t('plans.confirm_restore')}
          pending={busy}
          onConfirm={() => void setOnSale('restore')}
          onCancel={() => setConfirming(null)}
        />
      )}

      {canManage && pricing && (
        <PriceForm
          busy={busy}
          submitLabel={t('plans.schedule_price')}
          onSubmit={schedule}
          onCancel={() => setPricing(false)}
        />
      )}
    </section>
  )
}

/**
 * Amount in soles and the day it starts. Today (in Lima) is sent as "no date"
 * so the price takes effect now; any later day is midnight Lima of that day.
 */
function PriceForm({
  busy,
  submitLabel,
  onSubmit,
  onCancel,
  disabled = false,
}: {
  busy: boolean
  submitLabel: string
  onSubmit: (amountCents: number, validFrom: string | undefined) => void | Promise<void>
  onCancel?: () => void
  disabled?: boolean
}) {
  const t = useTranslations('bo')
  const [today] = useState(() => isoToLimaDate(new Date().toISOString()))
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(today)

  const cents = Math.round(Number(amount) * 100)
  const validAmount = amount.trim() !== '' && Number.isFinite(cents) && cents > 0
  const validDate = date !== '' && date >= today

  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1">
        <span className={labelClass}>{t('plans.amount')}</span>
        <input
          type="number"
          inputMode="decimal"
          step="0.01"
          min="0.01"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          className={fieldClass}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className={labelClass}>{t('plans.start')}</span>
        <input
          type="date"
          min={today}
          value={date}
          onChange={(event) => setDate(event.target.value)}
          className={fieldClass}
        />
        <span className="text-xs text-muted-foreground">{t('plans.start_hint')}</span>
      </label>
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={busy || disabled || !validAmount || !validDate}
          onClick={() =>
            void onSubmit(cents, date === today ? undefined : limaDateToIso(date))
          }
          className={primaryButtonClass}
        >
          <BoIcon name="check" size={16} />
          {submitLabel}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className={secondaryButtonClass}>
            {t('plans.cancel')}
          </button>
        )}
      </div>
    </div>
  )
}

function NewPlanForm({
  courseId,
  onChanged,
}: {
  courseId: string
  onChanged: (notice: Notice | null) => Promise<void>
}) {
  const t = useTranslations('bo')
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  async function create(amountCents: number, validFrom: string | undefined) {
    setBusy(true)
    const result = await catalogWrite(`/courses/${courseId}/plans`, 'POST', {
      name: name.trim(),
      amountCents,
      validFrom,
    })
    setBusy(false)
    if (!result.ok) {
      await onChanged({ kind: 'error', error: result.error })
      return
    }
    setName('')
    setOpen(false)
    await onChanged({ kind: 'created' })
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={`${secondaryButtonClass} gap-1.5 self-start`}>
        <BoIcon name="plus" size={16} />
        {t('plans.new_plan')}
      </button>
    )
  }

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-line p-4">
      <p className="text-sm font-semibold text-ink">{t('plans.new_plan')}</p>
      <label className="flex flex-col gap-1">
        <span className={labelClass}>{t('plans.plan_name')}</span>
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={t('plans.plan_name_placeholder')}
          className={fieldClass}
        />
      </label>
      <PriceForm
        busy={busy}
        disabled={name.trim().length === 0}
        submitLabel={t('plans.create_plan')}
        onSubmit={create}
        onCancel={() => setOpen(false)}
      />
    </section>
  )
}
