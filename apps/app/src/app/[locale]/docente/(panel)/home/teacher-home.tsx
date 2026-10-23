import { getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import type { StaffUser } from '@/lib/backoffice/types'
import { getTeachingSummary, listOwnClassGroups } from '@/lib/docente/teaching'
import { isoToLimaDate } from '@/lib/backoffice/lima-date'
import { slotsLabel } from '@/lib/backoffice/schedule'
import { formatDateRange, type Locale } from '@/lib/format'
import {
  Card,
  EmptyState,
  Meter,
  StatCard,
  StatusBadge,
  TableShell,
  tdClass,
  thClass,
} from '@/components/backoffice/ui'
import { classGroupTone, seatPressureTone } from '@/components/backoffice/status-tone'
import { BoIcon } from '@/components/backoffice/icons'
import { AutoGrid } from '@/components/layout/auto-grid'

/**
 * The home a teacher gets. Not the coordinator's home with the money taken out:
 * a different screen, because a different question is being asked — what am I
 * teaching, and to how many.
 *
 * Read from `GET /teaching/summary` and `/teaching/class-groups`, both scoped
 * by the session in the API's usecase (CLAUDE.md §8). The grades and the
 * certificates the class groups still owe join the home when they have an API
 * (OOC-38, OOC-33) — until then they are not on it, not even as a zero.
 */
export async function TeacherHome({
  staff,
  locale,
}: {
  staff: StaffUser
  locale: Locale
}) {
  const t = await getTranslations('bo')
  const [summary, classGroups] = await Promise.all([getTeachingSummary(), listOwnClassGroups()])

  const greeting = (
    <header>
      <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
        {t('dashboard.greeting', { name: staff.firstName })}
      </h1>
    </header>
  )

  if (!summary || !classGroups) {
    return (
      <div className="flex flex-col gap-6">
        {greeting}
        <EmptyState
          icon="alert"
          title={t('teacher_home.load_error_title')}
          body={t('teacher_home.load_error_body')}
        />
      </div>
    )
  }

  /* Nothing to teach — no class group allocated, or every one closed. Said
     once, in place of the figures and the table (OOC-101). */
  if (classGroups.length === 0) {
    return (
      <div className="flex flex-col gap-6">
        {greeting}
        <EmptyState
          icon="courses"
          title={t('teacher_home.no_active_title')}
          body={t('teacher_home.no_active_body')}
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {greeting}

      <AutoGrid as="section" min="15rem" gap="gap-3">
        <StatCard
          icon="courses"
          label={t('teacher_home.metric_class_groups')}
          value={String(summary.teaching)}
          hint={t('teacher_home.metric_class_groups_hint', { total: summary.inPortal })}
        />
        <StatCard
          icon="students"
          label={t('teacher_home.metric_students')}
          value={String(summary.students)}
          hint={t('teacher_home.metric_students_hint')}
          tone="success"
        />
      </AutoGrid>

      <section className="flex flex-col gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold text-ink">
            <BoIcon name="courses" size={16} className="text-brand-blue" />
            {t('nav.my_class_groups')}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('teacher_home.class_groups_subtitle')}
          </p>
        </div>

        <Card>
          <TableShell
            columns={[
              t('teacher_file.col_class_group'),
              t('teacher_file.col_schedule'),
              t('teacher_file.col_period'),
              t('teacher_file.col_seats'),
              t('teacher_file.col_status'),
            ]}
          >
            <thead>
              <tr>
                <th className={thClass}>{t('teacher_file.col_class_group')}</th>
                <th className={thClass}>{t('teacher_file.col_schedule')}</th>
                <th className={thClass}>{t('teacher_file.col_period')}</th>
                <th className={thClass}>{t('teacher_file.col_seats')}</th>
                <th className={thClass}>{t('teacher_file.col_status')}</th>
              </tr>
            </thead>
            <tbody>
              {classGroups.map((group) => (
                <tr key={group.id}>
                  <td className={`${tdClass} whitespace-nowrap`}>
                    <Link
                      href={`/docente/class-groups/${group.id}`}
                      className="font-semibold text-ink transition hover:text-brand-blue"
                    >
                      {group.courseName}
                    </Link>
                    <p className="text-xs tabular-nums text-muted-foreground">{group.code}</p>
                  </td>
                  <td
                    className={`${tdClass} whitespace-nowrap text-sm tabular-nums text-muted-foreground`}
                  >
                    {slotsLabel(group.slots, t)}
                  </td>
                  <td className={`${tdClass} whitespace-nowrap text-sm text-muted-foreground`}>
                    <span className="flex flex-col leading-tight">
                      <span>{group.academicPeriodName}</span>
                      {group.startsOn && group.endsOn && (
                        <span className="text-xs tabular-nums">
                          {formatDateRange(
                            isoToLimaDate(group.startsOn),
                            isoToLimaDate(group.endsOn),
                            locale,
                          )}
                        </span>
                      )}
                    </span>
                  </td>
                  <td className={`${tdClass} min-w-32`}>
                    <span className="flex flex-col gap-1">
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {t('seats.taken', { taken: group.seatsTaken, capacity: group.capacity })}
                      </span>
                      <Meter
                        value={group.seatsTaken}
                        max={group.capacity}
                        tone={seatPressureTone(group.seatsTaken, group.capacity)}
                      />
                    </span>
                  </td>
                  <td className={tdClass}>
                    <StatusBadge
                      tone={classGroupTone[group.status]}
                      label={t(`class_group_status.${group.status}`)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        </Card>
      </section>
    </div>
  )
}
