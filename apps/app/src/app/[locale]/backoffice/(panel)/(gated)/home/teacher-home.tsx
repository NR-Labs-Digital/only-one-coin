import type { ReactNode } from 'react'
import { getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import type { StaffUser } from '@/lib/backoffice/types'
import { getTeacher, listClassGroupsFor } from '@/lib/backoffice/mock-data'
import { isFeatureEnabled } from '@/lib/feature-flags/server'
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
 * a different screen, because a different question is being asked. The panel's
 * home exists to surface what needs a human right now — for coordination that
 * is the receipt queue and seat pressure, for a teacher it is the grades and
 * the certificates their own class groups are still owed
 * (`docs/REGRAS-NEGOCIO.md` §6: 25 business days).
 *
 * Everything here is scoped by the session's `teacherId`, never by anything the
 * client sent; the enforcing check is the usecase in `apps/api`
 * (CLAUDE.md §8).
 */
/**
 * The name of a class group. A door while the academic section is on the air,
 * plain text when it is not: the teacher still reads which group owes grades —
 * what the flag removes is the screen behind the name, not the fact
 * (CLAUDE.md §5).
 */
function GroupName({
  href,
  open,
  className,
  children,
}: {
  href: string
  open: boolean
  className: string
  children: ReactNode
}) {
  if (!open) return <span className={className}>{children}</span>
  return (
    <Link href={href} className={className}>
      {children}
    </Link>
  )
}

export async function TeacherHome({
  staff,
  locale,
}: {
  staff: StaffUser
  locale: Locale
}) {
  const t = await getTranslations('bo')
  const academic = await isFeatureEnabled('backoffice.academic')

  const teacher = staff.teacherId ? getTeacher(staff.teacherId) : undefined
  const classGroups = listClassGroupsFor(staff)
  const running = classGroups.filter(
    (group) => group.status === 'enrolling' || group.status === 'in_progress',
  )
  const owing = classGroups.filter((group) => group.pendingCertificates > 0)
  const gradesOwed = classGroups.filter((group) => group.pendingGrades > 0)

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
          {t('dashboard.greeting', { name: staff.firstName })}
        </h1>
      </header>


      <AutoGrid as="section" min="15rem" gap="gap-3">
        <StatCard
          icon="courses"
          label={t('teacher_home.metric_class_groups')}
          value={String(running.length)}
          hint={t('teacher_home.metric_class_groups_hint', {
            total: classGroups.length,
          })}
        />
        <StatCard
          icon="students"
          label={t('teacher_home.metric_students')}
          value={String(teacher?.studentCount ?? 0)}
          hint={t('teacher_home.metric_students_hint')}
          tone="success"
        />
        <StatCard
          icon="edit"
          label={t('teacher_home.metric_pending_grades')}
          value={String(teacher?.pendingGrades ?? 0)}
          hint={t('teacher_home.metric_pending_grades_hint')}
          tone={teacher?.pendingGrades ? 'warning' : 'neutral'}
        />
        <StatCard
          icon="doc"
          label={t('teacher_home.metric_pending_certificates')}
          value={String(teacher?.pendingCertificates ?? 0)}
          hint={t('teacher_home.metric_pending_certificates_hint')}
          tone={teacher?.pendingCertificates ? 'warning' : 'neutral'}
        />
      </AutoGrid>

      {/* Open grades come before everything: a certificate cannot go out over
          a missing grade, so this queue is upstream of the one below it. */}
      {gradesOwed.length > 0 && (
        <section className="flex flex-col gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-base font-semibold text-ink">
              <BoIcon name="edit" size={16} className="text-amber-500" />
              {t('teacher_home.grades_owing_title')}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {t('teacher_home.grades_owing_subtitle')}
            </p>
          </div>
          <AutoGrid min="20rem" gap="gap-3">
            {gradesOwed.map((group) => (
              <Card key={group.id} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    {/* Grades are entered on the working screen — the card
                        opens that group's tab, not the certificate page. */}
                    <GroupName
                      href={`/backoffice/class-groups?group=${group.id}`}
                      open={academic}
                      className="truncate text-sm font-semibold text-ink transition hover:text-brand-blue"
                    >
                      {group.courseName}
                    </GroupName>
                    <p className="truncate text-xs tabular-nums text-muted-foreground">
                      {group.code}
                    </p>
                  </div>
                  <StatusBadge
                    tone="warning"
                    label={t('teachers.pending_grades', {
                      count: group.pendingGrades,
                    })}
                  />
                </div>
              </Card>
            ))}
          </AutoGrid>
        </section>
      )}

      {/* Certificates second — they carry the 25-business-day deadline, but
          they only become issuable once the grades above are closed. */}
      {owing.length > 0 && (
        <section className="flex flex-col gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-base font-semibold text-ink">
              <BoIcon name="alert" size={16} className="text-amber-500" />
              {t('teacher_home.owing_title')}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {t('teacher_home.owing_subtitle')}
            </p>
          </div>
          <AutoGrid min="20rem" gap="gap-3">
            {owing.map((group) => (
              <Card key={group.id} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <GroupName
                      href={`/backoffice/class-groups/${group.id}`}
                      open={academic}
                      className="truncate text-sm font-semibold text-ink transition hover:text-brand-blue"
                    >
                      {group.courseName}
                    </GroupName>
                    <p className="truncate text-xs tabular-nums text-muted-foreground">
                      {group.code}
                    </p>
                  </div>
                  <StatusBadge
                    tone="warning"
                    label={t('teachers.pending_certificates', {
                      count: group.pendingCertificates,
                    })}
                  />
                </div>
              </Card>
            ))}
          </AutoGrid>
        </section>
      )}

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
          {classGroups.length === 0 ? (
            <div className="p-4">
              <EmptyState
                icon="courses"
                title={t('teacher_home.no_class_groups_title')}
                body={t('teacher_home.no_class_groups_body')}
              />
            </div>
          ) : (
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
                      {/* Opens the group's tab on the working screen. */}
                      <GroupName
                        href={`/backoffice/class-groups?group=${group.id}`}
                        open={academic}
                        className="font-semibold text-ink transition hover:text-brand-blue"
                      >
                        {group.courseName}
                      </GroupName>
                      <p className="text-xs tabular-nums text-muted-foreground">
                        {group.code}
                      </p>
                    </td>
                    <td
                      className={`${tdClass} whitespace-nowrap text-sm tabular-nums text-muted-foreground`}
                    >
                      {`${group.weekdays.map((day) => t(`weekday.${day}`)).join('/')} · ${group.startTime}`}
                    </td>
                    <td
                      className={`${tdClass} whitespace-nowrap text-sm text-muted-foreground`}
                    >
                      <span className="flex flex-col leading-tight">
                        <span>{group.academicPeriodName}</span>
                        <span className="text-xs tabular-nums">
                          {formatDateRange(group.startDate, group.endDate, locale)}
                        </span>
                      </span>
                    </td>
                    <td className={`${tdClass} min-w-32`}>
                      <span className="flex flex-col gap-1">
                        <span className="text-xs tabular-nums text-muted-foreground">
                          {t('seats.taken', {
                            taken: group.seatsTaken,
                            capacity: group.capacity,
                          })}
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
          )}
        </Card>
      </section>
    </div>
  )
}
