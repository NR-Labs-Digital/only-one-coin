'use client'

import { useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import type { ClassGroupRow } from '@/lib/backoffice/types'
import {
  addDays,
  addMonths,
  eventsOn,
  monthGrid,
  startOfMonth,
  weekDays,
  weekdayOf,
  type AgendaEvent,
} from '@/lib/backoffice/agenda'
import {
  formatDate,
  formatMonthYear,
  formatWeekRange,
  type Locale,
} from '@/lib/format'
import { Card, StatusBadge } from '@/components/backoffice/ui'
import { classGroupTone } from '@/components/backoffice/status-tone'
import { BoIcon } from '@/components/backoffice/icons'
import { ClassLinks } from '@/components/backoffice/class-links'

/**
 * The teacher's agenda, the way a calendar app reads: a week as a grid of
 * hours, a month as a wall calendar. Every class is a class group's weekly
 * slot landed on a date between its first and last day — derived, never
 * stored, so the agenda cannot disagree with the class groups.
 *
 * A class group carries its start time but not its length yet, so a class is
 * drawn one hour tall. That is a picture, not a rule: once the class group has
 * an end time, the block takes it.
 */

const VIEWS = ['week', 'month'] as const
type View = (typeof VIEWS)[number]

/** The day the grid draws — classes run between 06:00 and 22:00. */
const HOUR_START = 6
const HOUR_END = 22
const HOUR_PX = 48
/** Drawn length of a class until the class group carries its own. */
const VISUAL_DURATION_MIN = 60
/** Chips a month cell shows before folding the rest into "+N". */
const MONTH_CHIPS = 3

const HOURS = Array.from(
  { length: HOUR_END - HOUR_START },
  (_, index) => `${String(HOUR_START + index).padStart(2, '0')}:00`,
)

function eventKey(event: AgendaEvent): string {
  return `${event.group.id}:${event.day}`
}

export function TeacherAgenda({
  groups,
  today,
  nowMinutes,
}: {
  groups: ClassGroupRow[]
  /** Today in Lima, `YYYY-MM-DD` — from the server, so both renders agree. */
  today: string
  /** Minutes since midnight in Lima when the page was served. */
  nowMinutes: number
}) {
  const t = useTranslations('bo')
  const locale = useLocale() as Locale

  const [view, setView] = useState<View>('week')
  const [anchor, setAnchor] = useState(today)
  const [selected, setSelected] = useState<AgendaEvent | null>(null)

  const days = weekDays(anchor)
  const title =
    view === 'week'
      ? formatWeekRange(days[0], days[6], locale)
      : formatMonthYear(anchor, locale)

  function step(direction: 1 | -1) {
    setAnchor((current) =>
      view === 'week' ? addDays(current, 7 * direction) : addMonths(current, direction),
    )
    setSelected(null)
  }

  function openWeekOf(day: string) {
    setAnchor(day)
    setView('week')
  }

  const toolbarButton =
    'inline-flex min-h-tap items-center justify-center rounded-lg border border-line bg-white px-3 text-sm font-semibold text-ink transition hover:bg-sky-soft sm:min-h-0 sm:py-1.5'

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setAnchor(today)} className={toolbarButton}>
          {t('agenda.today')}
        </button>
        <button
          type="button"
          onClick={() => step(-1)}
          aria-label={t('agenda.previous')}
          className={`${toolbarButton} px-2`}
        >
          <BoIcon name="arrow-left" size={16} />
        </button>
        <button
          type="button"
          onClick={() => step(1)}
          aria-label={t('agenda.next')}
          className={`${toolbarButton} px-2`}
        >
          <BoIcon name="chevron-right" size={16} />
        </button>
        <h2 className="mr-auto text-lg font-semibold text-ink first-letter:uppercase">{title}</h2>

        <div role="tablist" className="flex rounded-lg border border-line bg-white p-0.5">
          {VIEWS.map((option) => (
            <button
              key={option}
              type="button"
              role="tab"
              aria-selected={view === option}
              onClick={() => setView(option)}
              className={`min-h-tap rounded-md px-3 text-sm font-semibold transition sm:min-h-0 sm:py-1 ${
                view === option ? 'bg-brand-blue text-white' : 'text-muted-foreground hover:text-ink'
              }`}
            >
              {t(`agenda.view_${option}`)}
            </button>
          ))}
        </div>
      </div>

      {/* Every time on this screen is Lima's: the class groups are scheduled
          in America/Lima, and a teacher abroad must not read them as theirs. */}
      <p className="-mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
        <BoIcon name="globe" size={13} />
        {t('agenda.timezone')}
      </p>

      {view === 'week' ? (
        <WeekView
          days={days}
          groups={groups}
          today={today}
          nowMinutes={nowMinutes}
          selectedKey={selected ? eventKey(selected) : null}
          onSelect={setSelected}
        />
      ) : (
        <MonthView
          anchor={anchor}
          groups={groups}
          today={today}
          selectedKey={selected ? eventKey(selected) : null}
          onSelect={setSelected}
          onOpenDay={openWeekOf}
        />
      )}

      {selected && (
        <Card className="flex flex-col gap-3 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-base font-semibold text-ink">
                {selected.group.courseName}
              </p>
              <p className="text-sm tabular-nums text-muted-foreground">
                {`${t(`weekday_long.${weekdayOf(selected.day)}`)}, ${formatDate(selected.day, locale)} · ${selected.startTime}`}
              </p>
              <p className="text-xs tabular-nums text-muted-foreground">
                {`${selected.group.code} · ${selected.group.academicPeriodName}`}
              </p>
            </div>
            <span className="flex items-center gap-2">
              <StatusBadge
                tone={classGroupTone[selected.group.status]}
                label={t(`class_group_status.${selected.group.status}`)}
              />
              <button
                type="button"
                onClick={() => setSelected(null)}
                aria-label={t('agenda.close')}
                className="grid size-8 place-items-center rounded-lg text-muted-foreground transition hover:bg-sky-soft hover:text-ink"
              >
                <BoIcon name="close" size={16} />
              </button>
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <ClassLinks group={selected.group} />
            <Link
              href={`/docente/class-groups?group=${selected.group.id}`}
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-blue transition hover:text-brand-blue-deep"
            >
              {t('agenda.open_class_group')}
              <BoIcon name="chevron-right" size={14} />
            </Link>
          </div>
        </Card>
      )}

      {groups.length === 0 && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <BoIcon name="clock" size={15} />
          {t('agenda.empty')}
        </p>
      )}
    </div>
  )
}

function DayHeading({ day, today }: { day: string; today: string }) {
  const t = useTranslations('bo')
  const isToday = day === today
  return (
    <span className="flex flex-col items-center gap-0.5 py-2">
      <span
        className={`text-[11px] font-semibold uppercase tracking-wide ${
          isToday ? 'text-brand-blue' : 'text-muted-foreground'
        }`}
      >
        {t(`weekday.${weekdayOf(day)}`)}
      </span>
      <span
        className={`grid size-8 place-items-center rounded-full text-base font-semibold tabular-nums ${
          isToday ? 'bg-brand-blue text-white' : 'text-ink'
        }`}
      >
        {Number(day.slice(8, 10))}
      </span>
    </span>
  )
}

function WeekView({
  days,
  groups,
  today,
  nowMinutes,
  selectedKey,
  onSelect,
}: {
  days: string[]
  groups: ClassGroupRow[]
  today: string
  nowMinutes: number
  selectedKey: string | null
  onSelect: (event: AgendaEvent) => void
}) {
  const height = (HOUR_END - HOUR_START) * HOUR_PX
  const nowTop = ((nowMinutes - HOUR_START * 60) / 60) * HOUR_PX
  const showNow = nowTop >= 0 && nowTop <= height

  return (
    /* Seven columns of hours do not fit a phone: the scroll lives on this
       wrapper, never on the page (`apps/app/CLAUDE.md`, layout). */
    <div className="overflow-x-auto rounded-xl border border-line bg-white">
      <div className="grid min-w-[48rem] grid-cols-[3.5rem_repeat(7,minmax(0,1fr))]">
        <span className="border-b border-line" />
        {days.map((day) => (
          <div key={day} className="border-b border-l border-line">
            <DayHeading day={day} today={today} />
          </div>
        ))}

        {/* Hour labels */}
        <div className="relative" style={{ height }}>
          {HOURS.map((hour, index) => (
            <span
              key={hour}
              className="absolute right-2 -translate-y-1/2 text-[11px] tabular-nums text-muted-foreground"
              style={{ top: index * HOUR_PX }}
            >
              {index === 0 ? '' : hour}
            </span>
          ))}
        </div>

        {days.map((day) => (
          <div key={day} className="relative border-l border-line" style={{ height }}>
            {HOURS.map((hour, index) => (
              <span
                key={hour}
                aria-hidden="true"
                className="absolute inset-x-0 border-t border-line/70"
                style={{ top: index * HOUR_PX }}
              />
            ))}

            {eventsOn(groups, day).map((event) => {
              const top = ((event.startMinutes - HOUR_START * 60) / 60) * HOUR_PX
              const active = selectedKey === eventKey(event)
              const upcoming = event.group.status === 'enrolling'
              return (
                <button
                  key={eventKey(event)}
                  type="button"
                  onClick={() => onSelect(event)}
                  className={`absolute inset-x-1 flex flex-col overflow-hidden rounded-md px-1.5 py-1 text-left text-[11px] leading-tight transition ${
                    upcoming
                      ? 'border border-brand-blue/40 bg-sky text-brand-blue-deep hover:bg-sky-soft'
                      : 'bg-brand-blue text-white hover:bg-brand-blue-deep'
                  } ${active ? 'ring-2 ring-brand-yellow ring-offset-1' : ''}`}
                  style={{ top, height: (VISUAL_DURATION_MIN / 60) * HOUR_PX - 2 }}
                >
                  <span className="truncate font-semibold">{event.group.courseName}</span>
                  <span className="truncate tabular-nums opacity-80">
                    {`${event.startTime} · ${event.group.code}`}
                  </span>
                </button>
              )
            })}

            {day === today && showNow && (
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-0 z-10 flex items-center"
                style={{ top: nowTop }}
              >
                <span className="-ml-1 size-2 rounded-full bg-red-500" />
                <span className="h-px flex-1 bg-red-500" />
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function MonthView({
  anchor,
  groups,
  today,
  selectedKey,
  onSelect,
  onOpenDay,
}: {
  anchor: string
  groups: ClassGroupRow[]
  today: string
  selectedKey: string | null
  onSelect: (event: AgendaEvent) => void
  onOpenDay: (day: string) => void
}) {
  const t = useTranslations('bo')
  const cells = monthGrid(anchor)
  const month = startOfMonth(anchor).slice(0, 7)

  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-white">
      <div className="grid min-w-[42rem] grid-cols-7">
        {cells.slice(0, 7).map((day) => (
          <span
            key={day}
            className="border-b border-line py-2 text-center text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
          >
            {t(`weekday.${weekdayOf(day)}`)}
          </span>
        ))}

        {cells.map((day, index) => {
          const events = eventsOn(groups, day)
          const inMonth = day.startsWith(month)
          const isToday = day === today
          return (
            <div
              key={day}
              className={`flex min-h-28 flex-col gap-1 border-line p-1.5 ${
                index % 7 === 0 ? '' : 'border-l'
              } ${index < 35 ? 'border-b' : ''} ${inMonth ? '' : 'bg-slate-50/70'}`}
            >
              <button
                type="button"
                onClick={() => onOpenDay(day)}
                className={`grid size-7 place-items-center self-center rounded-full text-xs font-semibold tabular-nums transition ${
                  isToday
                    ? 'bg-brand-blue text-white'
                    : inMonth
                      ? 'text-ink hover:bg-sky-soft'
                      : 'text-slate-400 hover:bg-sky-soft'
                }`}
              >
                {Number(day.slice(8, 10))}
              </button>

              {events.slice(0, MONTH_CHIPS).map((event) => (
                <button
                  key={eventKey(event)}
                  type="button"
                  onClick={() => onSelect(event)}
                  className={`flex items-center gap-1.5 truncate rounded px-1.5 py-0.5 text-left text-[11px] transition hover:bg-sky-soft ${
                    selectedKey === eventKey(event) ? 'bg-sky' : ''
                  }`}
                >
                  <span className="size-2 shrink-0 rounded-full bg-brand-blue" />
                  <span className="tabular-nums text-muted-foreground">{event.startTime}</span>
                  <span className="truncate font-semibold text-ink">{event.group.courseName}</span>
                </button>
              ))}

              {events.length > MONTH_CHIPS && (
                <button
                  type="button"
                  onClick={() => onOpenDay(day)}
                  className="px-1.5 text-left text-[11px] font-semibold text-muted-foreground transition hover:text-ink"
                >
                  {t('agenda.more', { count: events.length - MONTH_CHIPS })}
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
