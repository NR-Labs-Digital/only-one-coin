'use client'

import { useEffect, useId, useMemo, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import type { EnrollmentRow, WeeklySlotItem } from '@/lib/backoffice/types'
import { slotsLabel } from '@/lib/backoffice/schedule'
import { groupOffers, offerSeatsLeft, resolvePick } from '@/lib/backoffice/class-group-offers'
import { ClassGroupOfferOptions } from '@/components/backoffice/class-group-offer-options'
import { formatMoney, type Locale } from '@/lib/format'
import { RequiredMark } from '@/components/backoffice/ui'
import { BoIcon } from '@/components/backoffice/icons'
import { HelpHint } from '@/components/backoffice/help-hint'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

/** `GET /api/v1/enrollments/:id/move-targets`. */
interface MoveTargets {
  courseId: string
  classGroupId: string
  /** The module run the seat is in now (OOC-156). */
  classGroupModuleId: string
  /** One entry per module run: `id` is the run's, `classGroupId` its class group's. */
  classGroups: MoveTargetGroup[]
  plans: { id: string; courseId: string; name: string; amountCents: number }[]
}

interface MoveTargetGroup {
  id: string
  classGroupId: string
  code: string
  teacherName: string
  module: number | null
  fullCourse: boolean
  courseId: string
  academicPeriodId: string
  courseName: string
  academicPeriodName: string
  schedule: string
  slots: WeeklySlotItem[]
  startsOn: string | null
  endsOn: string | null
  status: 'enrolling' | 'in_progress'
  capacity: number
  seatsTaken: number
  seatsOver: number
}

/** Mirrors MOVE_REASON_MAX_LENGTH in @ooc/domain (the API refuses past it). */
const REASON_MAX = 500

/** Every refusal the move route answers with, as the locale names them. */
const KNOWN_ERRORS = new Set([
  'enrollment.class_group_full',
  'enrollment.move_seat_released',
  'enrollment.move_graded',
  'enrollment.move_same_class_group',
  'enrollment.move_target_unavailable',
  'enrollment.move_plan_required',
  'enrollment.move_plan_not_of_course',
  'enrollment.move_plan_not_allowed',
  'enrollment.move_reason_required',
  'enrollment.move_conflict',
  'enrollment.not_found',
])

/**
 * Moving an enrollment to another class group (OOC-84) — a staff tool, free of
 * charge: the payment never changes, whatever the target. Another course asks
 * for one of its plans, because the enrollment follows that plan's price from
 * here on; a full target asks for the over-capacity "yes" (OOC-155). The
 * reason is mandatory and goes to the audit log.
 *
 * The list is the API's (`movableClassGroup`): running class groups, full ones
 * included. What the seat counters say on screen is a moment old — the move's
 * own UPDATE decides, and a "full" answer comes back as the same question.
 */
export function MoveEnrollmentDialog({
  enrollment,
  onClose,
  onMoved,
}: {
  enrollment: EnrollmentRow | null
  onClose: () => void
  onMoved: (result: { overCapacity: boolean }) => void
}) {
  const t = useTranslations('bo')
  const locale = useLocale() as Locale

  const [targets, setTargets] = useState<MoveTargets | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  // A picker value (`lib/backoffice/class-group-offers`): a run by code, or
  // its schedule — the API then picks the class group (OOC-145).
  const [pick, setPick] = useState('')
  const targetFieldId = useId()
  const [planId, setPlanId] = useState('')
  const [overCapacityConfirmed, setOverCapacityConfirmed] = useState(false)
  const [fullOnServer, setFullOnServer] = useState(false)
  const [reason, setReason] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const enrollmentId = enrollment?.id ?? null

  useEffect(() => {
    if (!enrollmentId) return
    let cancelled = false
    setTargets(null)
    setLoadFailed(false)
    setPick('')
    setPlanId('')
    setOverCapacityConfirmed(false)
    setFullOnServer(false)
    setReason('')
    setError(null)
    fetch(`/api/v1/enrollments/${enrollmentId}/move-targets`)
      .then((response) => (response.ok ? (response.json() as Promise<MoveTargets>) : null))
      .then((data) => {
        if (cancelled) return
        if (data && Array.isArray(data.classGroups)) setTargets(data)
        else setLoadFailed(true)
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [enrollmentId])

  // Its own class group's other runs first, then the same course: moving a
  // student to another module or schedule is the usual move.
  const ordered = useMemo(() => {
    if (!targets) return []
    const rank = (item: MoveTargetGroup) =>
      item.classGroupId === targets.classGroupId ? 2 : item.courseId === targets.courseId ? 1 : 0
    return [...targets.classGroups].sort((a, b) => rank(b) - rank(a))
  }, [targets])
  const ownClassGroupId = targets?.classGroupId ?? null
  const offers = useMemo(() => groupOffers(ordered, ownClassGroupId), [ordered, ownClassGroupId])
  const picked = resolvePick(offers, pick)

  // The run the request names: the one picked, or the first of the schedule
  // (its own class group's, when it has one). Siblings share the course.
  const group = picked?.member ?? null
  const bySchedule = picked?.placement === 'schedule'
  const seatMembers = picked ? (bySchedule ? picked.offer.members : [picked.member]) : []
  const staysInOwn = seatMembers[0]?.classGroupId === ownClassGroupId
  const courseChanges = group !== null && targets !== null && group.courseId !== targets.courseId
  const coursePlans = useMemo(
    () => (group && targets ? targets.plans.filter((plan) => plan.courseId === group.courseId) : []),
    [group, targets],
  )
  /* Another run of the same class group keeps the seat where it is (OOC-156):
     a full class group is not a reason to ask, the seat is already counted.
     For the schedule, it is full only when nothing the API may try has room. */
  const groupFull = group !== null && !staysInOwn && (offerSeatsLeft(seatMembers) === 0 || fullOnServer)

  const codeOf = (item: MoveTargetGroup) =>
    item.module === null
      ? item.code
      : t('class_group_runs.code_with_module', { code: item.code, number: item.module })

  const taughtOf = (item: MoveTargetGroup) =>
    item.fullCourse
      ? t('class_group_runs.full_course')
      : item.module === null
        ? t('class_group_runs.no_module')
        : t('class_group_runs.module_label', { number: item.module })

  const scheduleOf = (item: MoveTargetGroup) =>
    item.slots.length > 0 ? slotsLabel(item.slots, t) : item.schedule

  const ready =
    group !== null &&
    (!courseChanges || planId !== '') &&
    (!groupFull || overCapacityConfirmed) &&
    reason.trim().length > 0 &&
    !pending

  async function submit() {
    if (!ready || !enrollmentId || !group) return
    setPending(true)
    setError(null)
    try {
      const response = await fetch(`/api/v1/enrollments/${enrollmentId}/move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          classGroupModuleId: group.id,
          placement: picked?.placement ?? 'class_group',
          planId: courseChanges ? planId : null,
          allowOverCapacity: groupFull && overCapacityConfirmed,
          reason: reason.trim(),
        }),
      })
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { reason?: string } | null
        const code = body?.reason ?? ''
        if (code === 'enrollment.class_group_full') {
          setFullOnServer(true)
          setOverCapacityConfirmed(false)
        }
        setError(KNOWN_ERRORS.has(code) ? code : 'failed')
        return
      }
      const result = (await response.json()) as { overCapacity: boolean }
      onMoved({ overCapacity: result.overCapacity })
    } catch {
      setError('failed')
    } finally {
      setPending(false)
    }
  }

  const fieldClass =
    'w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink outline-none transition focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/15'
  const labelClass = 'text-xs font-medium uppercase tracking-wide text-muted-foreground'

  return (
    <Dialog
      open={enrollment !== null}
      onOpenChange={(open) => {
        if (!open && !pending) onClose()
      }}
    >
      <DialogContent closeLabel={t('move_enrollment.close')} className="bg-white">
        {enrollment && (
          <>
            <DialogHeader className="gap-2 border-b border-line p-5 pr-14">
              <DialogTitle className="text-base font-semibold text-ink">
                {t('move_enrollment.title')}
              </DialogTitle>
              <DialogDescription>
                {t('move_enrollment.subtitle', {
                  student: enrollment.studentName,
                  from: enrollment.classGroupName,
                })}
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-4 p-5">
              {loadFailed ? (
                <p role="alert" className="text-sm text-red-700">
                  {t('move_enrollment.load_error')}
                </p>
              ) : targets === null ? (
                <p className="text-sm text-muted-foreground">{t('move_enrollment.loading')}</p>
              ) : targets.classGroups.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('move_enrollment.no_targets')}</p>
              ) : (
                <>
                  <div className="flex flex-col gap-1">
                    <span className="flex items-center gap-1.5">
                      <label htmlFor={targetFieldId} className={labelClass}>
                        {t('move_enrollment.field_class_group')}
                        <RequiredMark label={t('common.required')} />
                      </label>
                      <HelpHint
                        what={t('help.enr_move_target_what')}
                        how={t('help.enr_move_target_how')}
                      />
                    </span>
                    <select
                      id={targetFieldId}
                      value={pick}
                      onChange={(event) => {
                        setPick(event.target.value)
                        setPlanId('')
                        setOverCapacityConfirmed(false)
                        setFullOnServer(false)
                        setError(null)
                      }}
                      className={fieldClass}
                    >
                      <option value="">{t('move_enrollment.class_group_placeholder')}</option>
                      <ClassGroupOfferOptions
                        offers={offers}
                        ownClassGroupId={ownClassGroupId}
                        label={(item) =>
                          t('move_enrollment.class_group_option', {
                            code: codeOf(item),
                            course: item.courseName,
                            schedule: scheduleOf(item),
                            period: item.academicPeriodName,
                          })
                        }
                        heading={(offer) => {
                          const first = offer.members[0]!
                          return t('move_enrollment.offer_heading', {
                            course: first.courseName,
                            taught: taughtOf(first),
                            schedule: scheduleOf(first),
                            period: first.academicPeriodName,
                          })
                        }}
                        name={(item) =>
                          t('move_enrollment.offer_name', { course: item.courseName, taught: taughtOf(item) })
                        }
                        memberLabel={(item) =>
                          t('move_enrollment.offer_member', {
                            code: item.code,
                            course: item.courseName,
                            teacher: item.teacherName || t('class_group_runs.no_teacher'),
                          })
                        }
                      />
                    </select>
                  </div>

                  {group && bySchedule && (
                    <p className="text-xs text-muted-foreground">
                      {staysInOwn
                        ? t('class_group_picker.offer_stays', { code: group.code })
                        : t('class_group_picker.offer_seats', {
                            count: seatMembers.length,
                            left: offerSeatsLeft(seatMembers),
                          })}
                    </p>
                  )}
                  {group && !bySchedule && (
                    <p className="text-xs text-muted-foreground">
                      {t('move_enrollment.seats', {
                        taken: group.seatsTaken,
                        capacity: group.capacity,
                        over: group.seatsOver,
                      })}
                      {' · '}
                      {t(`class_group_status.${group.status}`)}
                    </p>
                  )}

                  {courseChanges && (
                    <label className="flex flex-col gap-1">
                      <span className={labelClass}>
                        {t('move_enrollment.field_plan')}
                        <RequiredMark label={t('common.required')} />
                      </span>
                      {coursePlans.length === 0 ? (
                        <span className="text-sm text-red-700">{t('move_enrollment.no_plans')}</span>
                      ) : (
                        <select
                          value={planId}
                          onChange={(event) => setPlanId(event.target.value)}
                          className={fieldClass}
                        >
                          <option value="">{t('move_enrollment.plan_placeholder')}</option>
                          {coursePlans.map((plan) => (
                            <option key={plan.id} value={plan.id}>
                              {`${plan.name} · ${formatMoney(plan.amountCents, 'PEN', locale)}`}
                            </option>
                          ))}
                        </select>
                      )}
                      <span className="text-xs text-muted-foreground">{t('move_enrollment.plan_notice')}</span>
                    </label>
                  )}

                  {groupFull && (
                    <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
                      <label className="flex flex-1 items-start gap-2">
                        <input
                          type="checkbox"
                          checked={overCapacityConfirmed}
                          onChange={(event) => setOverCapacityConfirmed(event.target.checked)}
                          className="mt-0.5 size-4 shrink-0 accent-amber-600"
                        />
                        <span>
                          <span className="block font-semibold">
                            {bySchedule ? t('class_group_picker.all_full_title') : t('move_enrollment.over_capacity_title')}
                          </span>
                          <span className="block text-xs">
                            {bySchedule
                              ? t('class_group_picker.all_full_body', { code: group!.code })
                              : t('move_enrollment.over_capacity_body')}
                          </span>
                        </span>
                      </label>
                      <HelpHint what={t('help.enr_over_capacity_what')} how={t('help.enr_over_capacity_how')} />
                    </div>
                  )}

                  <label className="flex flex-col gap-1">
                    <span className={labelClass}>
                      {t('move_enrollment.field_reason')}
                      <RequiredMark label={t('common.required')} />
                    </span>
                    <textarea
                      value={reason}
                      onChange={(event) => setReason(event.target.value.slice(0, REASON_MAX))}
                      rows={3}
                      maxLength={REASON_MAX}
                      placeholder={t('move_enrollment.reason_placeholder')}
                      className={fieldClass}
                    />
                  </label>

                  <p className="flex items-start gap-2 rounded-lg border border-dashed border-line bg-sky-soft px-3 py-2 text-xs text-muted-foreground">
                    <BoIcon name="shield" size={14} className="mt-0.5 shrink-0" />
                    {t('move_enrollment.money_notice')}
                  </p>
                </>
              )}

              {error && (
                <p role="alert" className="text-sm font-medium text-red-600">
                  {t(`move_enrollment.error.${error.replace('enrollment.', '')}`)}
                </p>
              )}

              <div className="flex flex-col-reverse gap-2 border-t border-line pt-4 sm:flex-row sm:items-center">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={pending}
                  className="min-h-tap rounded-lg border border-line px-3.5 py-2 text-sm font-semibold text-muted-foreground transition hover:text-ink disabled:opacity-60"
                >
                  {t('move_enrollment.cancel')}
                </button>
                <button
                  type="button"
                  disabled={!ready}
                  onClick={() => void submit()}
                  className="inline-flex min-h-tap items-center justify-center gap-1.5 rounded-lg bg-brand-blue px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-brand-blue-deep disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-brand-blue"
                >
                  <BoIcon name="check" size={16} />
                  {pending ? t('move_enrollment.saving') : t('move_enrollment.submit')}
                </button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
