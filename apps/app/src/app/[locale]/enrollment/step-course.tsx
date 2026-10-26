'use client'

import { useMemo } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import type { CheckoutDraft, HoldOutcome, PublicCatalog } from '@/lib/enrollment/types'
import {
  coursesOfLanguage,
  courseById,
  groupsOnStartDate,
  hasSeat,
  planOfCourse,
  seatsLeft,
  startDatesOfCourse,
} from '@/lib/enrollment/checkout'
import { scheduleLines } from '@/lib/enrollment/schedule'
import { formatDate, formatMoney, type Locale } from '@/lib/format'
import {
  Card,
  ChoiceCard,
  Note,
  PrimaryButton,
  StepNav,
  StepHeading,
  SummaryRow,
} from '@/components/enrollment/ui'
import { CheckoutIcon } from '@/components/enrollment/icons'
import { AutoGrid } from '@/components/layout/auto-grid'

/** Below this the class group is advertised as nearly gone; above, it is not. */
const SCARCE_SEATS = 6

/**
 * Step 1 — what is being bought.
 *
 * Runs in the order the WhatsApp funnel already uses
 * (`docs/REGRAS-NEGOCIO.md` §7): language → course → **start date** →
 * schedule, and only then the price. Asking for money before the reader knows
 * what time the class is is how a funnel loses people who would have paid.
 *
 * The date is its own choice, not a property of the schedule. Coordination
 * opens the same course on several dates — this week, or the class group at the
 * end of the month — each with its own three or four hours. Flattening that
 * into one list of twelve is how somebody picks a convenient hour on a date
 * they cannot make.
 *
 * Two rules the screen has to keep:
 *
 * - **A full class group is never offered.** The seat is claimed by one atomic
 *   instruction on the server (`CLAUDE.md` §5), so an offer this screen cannot
 *   honour becomes a submit that fails after everything was filled in. Full
 *   ones stay visible but unpickable — knowing the 07:00 class exists and is
 *   full is worth more than it silently vanishing.
 * - **The price is read, never typed.** It is the `plan_price` in force, and
 *   there are no discounts, ever (`CLAUDE.md` §1).
 */
export function StepCourse({
  catalog,
  draft,
  setDraft,
  holding,
  holdError,
  onContinue,
}: {
  catalog: PublicCatalog
  draft: CheckoutDraft
  setDraft: (next: (prev: CheckoutDraft) => CheckoutDraft) => void
  /** The seat is being asked for; continuing twice would ask twice. */
  holding: boolean
  /** Why the server did not hand over the seat, when it did not. */
  holdError: Exclude<HoldOutcome, 'held'> | null
  onContinue: () => void
}) {
  const t = useTranslations('enrollment')
  const locale = useLocale() as Locale

  const { languageId, courseId, startDate, classGroupId } = draft.course
  const courses = useMemo(
    () => coursesOfLanguage(catalog, languageId),
    [catalog, languageId],
  )
  const startDates = useMemo(
    () => startDatesOfCourse(catalog, courseId),
    [catalog, courseId],
  )
  const groups = useMemo(
    () => groupsOnStartDate(catalog, courseId, startDate),
    [catalog, courseId, startDate],
  )
  const course = courseById(catalog, courseId)
  const plan = planOfCourse(catalog, courseId)
  const selectedGroup = groups.find((group) => group.id === classGroupId) ?? null

  function pickLanguage(id: string) {
    // Changing the language invalidates everything downstream — a course from
    // the previous language would sit there looking chosen.
    setDraft((prev) => ({
      ...prev,
      course: {
        languageId: id,
        courseId: null,
        startDate: null,
        classGroupId: null,
      },
    }))
  }

  function pickCourse(id: string) {
    setDraft((prev) => ({
      ...prev,
      course: {
        ...prev.course,
        courseId: id,
        startDate: null,
        classGroupId: null,
      },
    }))
  }

  function pickStartDate(date: string) {
    // A schedule belongs to a date. Keeping the previous class group selected
    // while the date moves under it is how a summary ends up showing an hour
    // that does not exist on the date beside it.
    setDraft((prev) => ({
      ...prev,
      course: { ...prev.course, startDate: date, classGroupId: null },
    }))
  }

  function pickGroup(id: string) {
    setDraft((prev) => ({ ...prev, course: { ...prev.course, classGroupId: id } }))
  }

  const schedule = (group: Parameters<typeof scheduleLines>[0]) =>
    scheduleLines(
      group,
      (day) => t(`weekday.${day}`),
      (vars) => t('time_range', vars),
    )

  /** The week as a small stack — day on the left, hours on the right. */
  const scheduleBlock = (group: Parameters<typeof scheduleLines>[0]) => (
    <span className="flex flex-col gap-0.5">
      {schedule(group).map((line) => (
        <span key={line.key} className="flex items-baseline gap-2">
          <span className="text-sm font-semibold text-ink">{line.day}</span>
          <span aria-hidden="true" className="text-muted-foreground">
            —
          </span>
          <span className="text-sm font-semibold text-ink">{line.time}</span>
        </span>
      ))}
    </span>
  )

  return (
    <div className="flex flex-col gap-5">
      <StepHeading
        title={t('step.course.title')}
        subtitle={t('step.course.subtitle')}
      />

      {/* Language */}
      <Card className="p-5">
        <p className="mb-3 text-sm font-semibold text-ink">
          {t('step.course.language_label')}
        </p>
        {/* Catálogo vazio não é erro de rede: a API respondeu, só não há
            grupo `enrolling` aberto. Sem isto o card fica em branco — que lê
            como página quebrada, não como matrícula fechada. */}
        {catalog.languages.length === 0 && (
          <p className="text-sm text-muted-foreground">
            {t('step.course.catalog_empty')}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          {catalog.languages.map((language) => (
            <button
              key={language.id}
              type="button"
              onClick={() => pickLanguage(language.id)}
              aria-pressed={languageId === language.id}
              className={`rounded-full border px-4 py-2 text-sm font-semibold transition ${
                languageId === language.id
                  ? 'border-brand-blue bg-brand-blue text-white'
                  : 'border-line bg-white text-ink hover:border-brand-blue/50 hover:bg-sky-soft'
              }`}
            >
              {language.name}
            </button>
          ))}
        </div>
      </Card>

      {/* Course */}
      {courses.length > 0 && (
        <Card className="p-5">
          <p className="mb-3 text-sm font-semibold text-ink">
            {t('step.course.course_label')}
          </p>
          <AutoGrid min="17rem" gap="gap-3">
            {courses.map((item) => (
              <ChoiceCard
                key={item.id}
                selected={courseId === item.id}
                onSelect={() => pickCourse(item.id)}
                title={item.name}
                meta={t('step.course.course_meta', {
                  level: item.level,
                  hours: item.totalHours,
                  modules: item.modules,
                })}
              >
                <span className="mt-1 inline-flex w-fit items-center gap-1.5 rounded-full bg-sky px-2.5 py-1 text-[0.6875rem] font-semibold text-brand-blue-deep">
                  <CheckoutIcon name="user" size={12} />
                  {t('step.course.min_age', { age: item.minAge })}
                </span>
              </ChoiceCard>
            ))}
          </AutoGrid>
        </Card>
      )}

      {/* Start date — its own choice, before the hour */}
      {course && (
        <Card className="p-5">
          <p className="mb-1 text-sm font-semibold text-ink">
            {t('step.course.start_date_label')}
          </p>
          <p className="mb-3 text-xs text-muted-foreground">
            {t('step.course.start_date_hint')}
          </p>

          {startDates.length === 0 ? (
            <Note tone="warning">{t('step.course.no_start_dates')}</Note>
          ) : (
            <AutoGrid min="15rem" gap="gap-3">
              {startDates.map((option) => (
                <ChoiceCard
                  key={option.startDate}
                  selected={startDate === option.startDate}
                  onSelect={() => pickStartDate(option.startDate)}
                  title={formatDate(option.startDate, locale)}
                  meta={t('step.course.schedules_on_date', {
                    count: option.openGroups,
                  })}
                >
                  {option.seatsLeft <= SCARCE_SEATS && (
                    <span className="mt-1 inline-flex w-fit items-center gap-1.5 rounded-full bg-brand-yellow/20 px-2.5 py-1 text-[0.6875rem] font-semibold text-brand-yellow-deep">
                      <CheckoutIcon name="seat" size={12} />
                      {t('step.course.seats_left', { count: option.seatsLeft })}
                    </span>
                  )}
                </ChoiceCard>
              ))}
            </AutoGrid>
          )}
        </Card>
      )}

      {/* Schedule, within the chosen date */}
      {course && startDate && (
        <Card className="p-5">
          <p className="mb-1 text-sm font-semibold text-ink">
            {t('step.course.group_label')}
          </p>
          <p className="mb-3 text-xs text-muted-foreground">
            {t('step.course.group_hint')}
          </p>

          {groups.length === 0 ? (
            <Note tone="warning">{t('step.course.no_groups')}</Note>
          ) : (
            <AutoGrid min="18rem" gap="gap-3">
              {groups.map((group) => {
                const open = hasSeat(group)
                const left = seatsLeft(group)
                return (
                  <ChoiceCard
                    key={group.id}
                    selected={classGroupId === group.id}
                    disabled={!open}
                    onSelect={() => pickGroup(group.id)}
                    title={scheduleBlock(group)}
                    aside={
                      open ? (
                        left <= SCARCE_SEATS ? (
                          <span className="shrink-0 rounded-full bg-brand-yellow/20 px-2 py-0.5 text-[0.6875rem] font-semibold text-brand-yellow-deep">
                            {t('step.course.seats_left', { count: left })}
                          </span>
                        ) : null
                      ) : (
                        <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[0.6875rem] font-semibold text-muted-foreground">
                          {t('step.course.group_full')}
                        </span>
                      )
                    }
                  >
                    <span className="mt-1.5 text-xs text-muted-foreground">
                      {t('step.course.teacher', { name: group.teacherName })}
                    </span>
                  </ChoiceCard>
                )
              })}
            </AutoGrid>
          )}
        </Card>
      )}

      {/* Price — appears only once there is a class group to attach it to. */}
      {course && plan && selectedGroup && (
        <Card className="p-5">
          <p className="mb-2 text-sm font-semibold text-ink">
            {t('step.course.summary_label')}
          </p>
          <dl className="divide-y divide-line">
            <SummaryRow label={t('summary.course')}>{course.name}</SummaryRow>
            <SummaryRow label={t('summary.plan')}>{plan.name}</SummaryRow>
            <SummaryRow label={t('summary.starts_on')}>
              {formatDate(selectedGroup.startDate, locale)}
            </SummaryRow>
            <SummaryRow label={t('summary.schedule')}>
              <span className="flex flex-col items-end gap-0.5">
                {schedule(selectedGroup).map((line) => (
                  <span key={line.key}>{`${line.day} — ${line.time}`}</span>
                ))}
              </span>
            </SummaryRow>
            <SummaryRow label={t('summary.total')} strong>
              {formatMoney(plan.amountCents, plan.currency, locale)}
            </SummaryRow>
          </dl>
          <p className="mt-3 text-xs text-muted-foreground">
            {t('step.course.single_payment_note')}
          </p>
        </Card>
      )}

      {/* The catalog on screen can be minutes old; the server's seat count is
          the one that decides. */}
      {holdError && (
        <Note tone="danger">
          {t(holdError === 'full' ? 'hold.full' : 'hold.failed')}
        </Note>
      )}

      <StepNav>
        <PrimaryButton onClick={onContinue} disabled={selectedGroup === null || holding}>
          {t('action.continue')}
          <CheckoutIcon name="arrow-right" size={16} />
        </PrimaryButton>
      </StepNav>

      {/* The hold is announced before it starts, not after. Somebody who does
          not know a clock is running cannot plan around it. */}
      {selectedGroup && (
        <Note tone="info">
          {t('hold.will_start', { minutes: catalog.settings.holdMinutes })}
        </Note>
      )}
    </div>
  )
}
