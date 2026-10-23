import { notFound } from 'next/navigation'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { getClassGroupFor, listClassGroupsFor } from '@/lib/backoffice/mock-data'
import { getTeacherSession } from '@/lib/backoffice/session'
import { addBusinessDays, businessDaysUntil } from '@/lib/backoffice/certificates'
import { getPlatformSettings } from '@/lib/backoffice/platform-settings'
import { formatDate, type Locale } from '@/lib/format'
import { Card, EmptyState, Field, Meter, StatusBadge } from '@/components/backoffice/ui'
import { classGroupTone, seatPressureTone } from '@/components/backoffice/status-tone'
import { BoIcon } from '@/components/backoffice/icons'
import { ClassLinks } from '@/components/backoffice/class-links'
import { AutoGrid } from '@/components/layout/auto-grid'
import { ClassGroupCertificates } from './class-group-certificates'

/**
 * One of the teacher's class groups, with its certificate batch. Read from the
 * mock: the roster, grades and certificates have no API yet (Sessão 36).
 *
 * Somebody else's class group answers exactly like one that does not exist.
 * Hiding the link would stop nobody — the id in the URL is guessable
 * (anti-IDOR, CLAUDE.md §8).
 */
export default async function TeacherClassGroupDetailPage({
  params,
}: {
  params: Promise<{ locale: string; classGroupId: string }>
}) {
  const { locale: raw, classGroupId } = await params
  const locale = raw as Locale
  setRequestLocale(raw)
  const t = await getTranslations('bo')

  const staff = await getTeacherSession()
  const group = getClassGroupFor(staff, classGroupId)
  /* A closed group is gone from the teacher's portal — by URL as well. */
  if (!group || group.status === 'closed') notFound()

  const backLink = (
    <Link
      href="/docente/class-groups"
      className="inline-flex w-fit items-center gap-1.5 text-sm font-semibold text-muted-foreground transition hover:text-ink"
    >
      <BoIcon name="arrow-left" size={16} />
      {t('class_group.back_to_list')}
    </Link>
  )

  /* The certificate rules — passing grade and deadline — are the backoffice's
     (OOC-41). Without them the batch cannot be judged, so the page says so
     instead of judging it on a guess. */
  const settings = await getPlatformSettings()
  if (!settings) {
    return (
      <div className="flex flex-col gap-5">
        {backLink}
        <EmptyState
          icon="alert"
          title={t('settings.rules_load_error_title')}
          body={t('settings.rules_load_error_body')}
        />
      </div>
    )
  }

  /* The free certificate is owed within the configured business days of the
     end (`docs/REGRAS-NEGOCIO.md` §6). Computed on the server: a client
     component could disagree with it across a day boundary. */
  const deadline = addBusinessDays(group.endDate, settings.certificateDeadlineBusinessDays)
  const businessDaysLeft = businessDaysUntil(deadline, new Date())
  const teaching = group.status === 'enrolling' || group.status === 'in_progress'

  return (
    <div className="flex flex-col gap-5">
      {backLink}

      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold tracking-tight text-ink">
              {group.courseName}
            </h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {`${group.language.name} · ${group.academicPeriodName}`}
            </p>
          </div>
          <StatusBadge
            tone={classGroupTone[group.status]}
            label={t(`class_group_status.${group.status}`)}
          />
        </div>

        <AutoGrid as="dl" min="17rem" className="mt-5">
          <Field label={t('class_group.field_code')}>
            <span className="tabular-nums">{group.code}</span>
          </Field>
          <Field label={t('class_group.field_schedule')}>
            {`${group.weekdays.map((day) => t(`weekday.${day}`)).join('/')} · ${group.startTime}`}
          </Field>
          <Field label={t('class_group.field_start')}>{formatDate(group.startDate, locale)}</Field>
          <Field label={t('class_group.field_end')}>{formatDate(group.endDate, locale)}</Field>
          <div className="min-w-0">
            <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t('class_group.field_seats')}
            </dt>
            <dd className="mt-0.5 flex flex-col gap-1.5">
              <span className="text-sm font-medium tabular-nums text-ink">
                {`${group.seatsTaken} / ${group.capacity}`}
              </span>
              <Meter
                value={group.seatsTaken}
                max={group.capacity}
                tone={seatPressureTone(group.seatsTaken, group.capacity)}
              />
            </dd>
          </div>
        </AutoGrid>

        {teaching && <ClassLinks group={group} className="mt-5" />}
      </Card>

      <ClassGroupCertificates
        group={group}
        classGroups={listClassGroupsFor(staff)}
        canManage={false}
        // Date only: the deadline is a calendar day, not an instant.
        deadlineIso={deadline.toISOString().slice(0, 10)}
        businessDaysLeft={businessDaysLeft}
        passingGrade={settings.passingGrade}
      />
    </div>
  )
}
