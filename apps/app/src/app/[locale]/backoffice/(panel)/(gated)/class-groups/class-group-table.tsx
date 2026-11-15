'use client'

import type { MouseEvent, ReactNode } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Link, useRouter } from '@/i18n/navigation'
import type { ClassGroupItem, ClassGroupModuleItem } from '@/lib/backoffice/types'
import { slotsLabel } from '@/lib/backoffice/schedule'
import { formatDateRange, type Locale } from '@/lib/format'
import { Meter, StatusBadge, TableShell, tdClass, thClass } from '@/components/backoffice/ui'
import { classGroupTone, seatPressureTone } from '@/components/backoffice/status-tone'

/** How many cells a row has — a divider row spans all of them. */
export const CLASS_GROUP_COLUMNS = 6

/**
 * The class group table: headings once, rows below. Both sections of the
 * screen (running and closed) use it, so they read the same column for column.
 * The headings go to `TableShell` too — on a phone each cell prints its own
 * column name, matched by position (`apps/app/CLAUDE.md`, Celular).
 */
export function ClassGroupTable({ children }: { children: ReactNode }) {
  const t = useTranslations('bo')
  const columns = [
    t('class_groups.col_class_group'),
    t('class_groups.col_teacher'),
    t('class_groups.col_schedule'),
    t('class_groups.col_dates'),
    t('class_groups.col_seats'),
    t('class_groups.col_status'),
  ]
  return (
    <TableShell columns={columns}>
      <thead>
        <tr>
          {columns.map((column) => (
            <th key={column} className={thClass}>
              {column}
            </th>
          ))}
        </tr>
      </thead>
      {children}
    </TableShell>
  )
}

/**
 * One class group. The whole row opens it, not just the name: the anchor stays
 * in the first cell so the keyboard, the screen reader and ctrl+click keep
 * working — the row handler only covers the mouse, and steps aside when the
 * click already landed on the link.
 */
export function ClassGroupTableRow({
  row,
  closedBecause,
}: {
  row: ClassGroupItem
  /**
   * Why its seats are closed, on the pending list (OOC-97). An in-progress
   * class group already says so in its status badge, so only these two show.
   */
  closedBecause?: 'full' | 'window_closed'
}) {
  const t = useTranslations('bo')
  const locale = useLocale() as Locale
  const router = useRouter()
  const href = `/backoffice/class-groups/${row.id}`
  /* Several module runs (OOC-156): teacher and schedule are each run's, one line per run. */
  const severalRuns = row.modules.length > 1

  return (
    <tr
      className="cursor-pointer transition hover:bg-sky-soft"
      onClick={(event: MouseEvent<HTMLTableRowElement>) => {
        if ((event.target as HTMLElement).closest('a')) return
        router.push(href)
      }}
    >
      <td className={tdClass}>
        <Link href={href} className="font-semibold text-ink transition hover:text-brand-blue">
          {row.courseName}
        </Link>
        <span className="block text-xs tabular-nums text-muted-foreground">
          {severalRuns
            ? `${row.code} · ${t('class_group_runs.count', { count: row.modules.length })}`
            : row.fullCourse
              ? `${row.code} · ${t('class_groups.module_full_course')}`
              : row.module === null
                ? row.code
                : `${row.code} · ${t('class_groups.module_option', { number: row.module })}`}
        </span>
      </td>
      <td className={`${tdClass} text-sm text-muted-foreground`}>
        {severalRuns ? (
          <RunLines runs={row.modules} render={(run) => run.teacherName || t('class_group_runs.no_teacher')} />
        ) : (
          <TeacherCell row={row} />
        )}
      </td>
      <td className={`${tdClass} text-sm tabular-nums text-muted-foreground`}>
        {severalRuns ? (
          <RunLines runs={row.modules} render={(run) => slotsLabel(run.slots, t)} />
        ) : (
          slotsLabel(row.slots, t)
        )}
      </td>
      <td className={`${tdClass} whitespace-nowrap text-sm tabular-nums text-muted-foreground`}>
        {row.startsOn && row.endsOn
          ? formatDateRange(row.startsOn, row.endsOn, locale)
          : t('class_groups.no_dates')}
      </td>
      <td className={tdClass}>
        <span className="flex w-28 flex-col gap-1.5">
          <span className="flex items-baseline justify-between gap-1">
            <span className="text-xs font-semibold tabular-nums text-ink">
              {`${row.seatsTaken} / ${row.capacity}`}
              {/* Seats above capacity (OOC-155), apart from the regular
                  count so "30 / 30" keeps meaning the class group's real
                  size: "30 / 30 +2". */}
              {row.seatsOver > 0 && (
                <span
                  className="ml-1 text-amber-700"
                  title={t('class_groups.seats_over_hint', { count: row.seatsOver })}
                >
                  {t('class_groups.seats_over', { count: row.seatsOver })}
                </span>
              )}
            </span>
            <span className="text-[11px] tabular-nums text-muted-foreground">
              {t('class_groups.seats_left', {
                count: Math.max(0, row.capacity - row.seatsTaken - row.seatsOver),
              })}
            </span>
          </span>
          <Meter
            value={Math.min(row.capacity, row.seatsTaken + row.seatsOver)}
            max={row.capacity}
            tone={seatPressureTone(row.seatsTaken + row.seatsOver, row.capacity)}
          />
          {row.waitlistCount > 0 && (
            <span className="text-[11px] font-semibold tabular-nums text-amber-700">
              {t('class_groups.waitlist_count', { count: row.waitlistCount })}
            </span>
          )}
        </span>
      </td>
      <td className={tdClass}>
        <span className="flex flex-wrap gap-1.5">
          <StatusBadge
            tone={classGroupTone[row.status]}
            label={t(`class_group_status.${row.status}`)}
          />
          {closedBecause && (
            <StatusBadge tone="neutral" label={t(`class_groups.pending_reason_${closedBecause}`)} />
          )}
          {!row.active && <StatusBadge tone="neutral" label={t('class_groups.retired')} />}
          {!row.courseActive && (
            <StatusBadge tone="warning" label={t('class_groups.course_off_catalog')} />
          )}
          {/* Selling or running with a module still missing its Classroom: a
              finding, not a block (OOC-98, per module since OOC-144). */}
          {row.classroomMissing && (row.status === 'enrolling' || row.status === 'in_progress') && (
            <StatusBadge tone="warning" label={t('class_groups.classroom_missing')} />
          )}
        </span>
      </td>
    </tr>
  )
}

/** One line per module run, labelled by its module — the teacher or the week of each. */
function RunLines({ runs, render }: { runs: ClassGroupModuleItem[]; render: (run: ClassGroupModuleItem) => string }) {
  const t = useTranslations('bo')
  return (
    <span className="flex flex-col gap-0.5">
      {runs.map((run) => (
        <span key={run.id} className="block">
          <span className="font-semibold text-ink">
            {run.fullCourse
              ? t('class_group_runs.full_short')
              : run.module === null
                ? t('class_group_runs.unset_short')
                : t('class_group_runs.module_short', { number: run.module })}
          </span>
          {` · ${render(run)}`}
        </span>
      ))}
    </span>
  )
}

/**
 * The teacher cell, here and on the class group page. Nobody allocated is a
 * finding, not an empty cell (OOC-80): the class group cannot reach a
 * teacher's screen, grades or certificates until coordination links it — the
 * name typed before teachers had a file stays as a hint for whoever does.
 */
export function TeacherCell({ row }: { row: ClassGroupItem }) {
  const t = useTranslations('bo')
  if (row.teacherId) return <>{row.teacherName}</>
  return (
    <span className="flex flex-col items-start gap-1">
      <StatusBadge tone="warning" label={t('class_groups.teacher_unassigned')} />
      {row.legacyTeacherName && (
        <span className="text-xs text-muted-foreground">
          {t('class_groups.teacher_legacy_hint', { name: row.legacyTeacherName })}
        </span>
      )}
    </span>
  )
}
