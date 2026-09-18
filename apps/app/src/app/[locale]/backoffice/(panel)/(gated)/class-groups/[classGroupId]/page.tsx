import { notFound } from 'next/navigation'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import {
  getClassGroupFor,
  listClassGroupsFor,
} from '@/lib/backoffice/mock-data'
import { getStaffSession } from '@/lib/backoffice/session'
import { canManageEnrollment } from '@/lib/backoffice/permissions'
import {
  addBusinessDays,
  businessDaysUntil,
  CERTIFICATE_DEADLINE_BUSINESS_DAYS,
} from '@/lib/backoffice/certificates'
import { formatDate, type Locale } from '@/lib/format'
import {
  Card,
  Field,
  Meter,
  StatusBadge,
} from '@/components/backoffice/ui'
import { classGroupTone, seatPressureTone } from '@/components/backoffice/status-tone'
import { BoIcon } from '@/components/backoffice/icons'
import { ClassGroupCertificates } from './class-group-certificates'
import { AutoGrid } from '@/components/layout/auto-grid'

/**
 * One class group. The deadline is computed here, on the server, and handed
 * down as a prop: doing it inside the client component would let the server and
 * the client disagree across a day boundary.
 */
export default async function ClassGroupDetailPage({
  params,
}: {
  params: Promise<{ locale: string; classGroupId: string }>
}) {
  const { locale, classGroupId } = await params
  setRequestLocale(locale)
  const t = await getTranslations('bo')

  const staff = await getStaffSession()

  /* Somebody else's class group answers exactly like one that does not exist.
     Hiding the link would stop nobody — the id in the URL is guessable
     (anti-IDOR, CLAUDE.md §8). */
  const group = getClassGroupFor(staff, classGroupId)
  if (!group) notFound()

  const deadline = addBusinessDays(
    group.endDate,
    CERTIFICATE_DEADLINE_BUSINESS_DAYS,
  )
  const businessDaysLeft = businessDaysUntil(deadline, new Date())

  return (
    <div className="flex flex-col gap-5">
      <Link
        href="/backoffice/class-groups"
        className="inline-flex w-fit items-center gap-1.5 text-sm font-semibold text-muted-foreground transition hover:text-ink"
      >
        <BoIcon name="arrow-left" size={16} />
        {t('class_group.back_to_list')}
      </Link>

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
          {/* Modality is not shown: the institution is 100% virtual
              (`docs/REGRAS-NEGOCIO.md` §8), so the badge always read "online"
              and carried no information. */}
          <StatusBadge
            tone={classGroupTone[group.status]}
            label={t(`class_group_status.${group.status}`)}
          />
        </div>

        {/* Period lives in the subtitle above, so it is not repeated here. The
            date range is split in two fields on purpose: as one string it hit
            the field's truncation and lost the end date. */}
        <AutoGrid as="dl" min="17rem" className="mt-5">
          <Field label={t('class_group.field_code')}>
            <span className="tabular-nums">{group.code}</span>
          </Field>
          <Field label={t('class_group.field_teacher')}>{group.teacherName}</Field>
          <Field label={t('class_group.field_schedule')}>
            {`${group.weekdays.map((day) => t(`weekday.${day}`)).join('/')} · ${group.startTime}`}
          </Field>
          <Field label={t('class_group.field_start')}>
            {formatDate(group.startDate, locale as Locale)}
          </Field>
          <Field label={t('class_group.field_end')}>
            {formatDate(group.endDate, locale as Locale)}
          </Field>
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
      </Card>


      <ClassGroupCertificates
        group={group}
        classGroups={listClassGroupsFor(staff)}
        canManage={canManageEnrollment(staff.role)}
        // Date only: the deadline is a calendar day, not an instant.
        deadlineIso={deadline.toISOString().slice(0, 10)}
        businessDaysLeft={businessDaysLeft}
      />
    </div>
  )
}
