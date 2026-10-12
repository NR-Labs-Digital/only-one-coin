import { notFound } from 'next/navigation'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import {
  getClassGroupFor,
  listClassGroupsFor,
} from '@/lib/backoffice/mock-data'
import {
  getCatalogClassGroup,
  listCatalogCourses,
  listCatalogWaitlist,
  listTeacherOptions,
} from '@/lib/backoffice/catalog'
import { slotsLabel } from '@/lib/backoffice/schedule'
import { isoToLimaDate } from '@/lib/backoffice/lima-date'
import { getStaffSession } from '@/lib/backoffice/session'
import {
  canBrowseCatalog,
  canCreateClassGroup,
  canCreateEnrollment,
  canManageEnrollment,
  isRestrictedToOwnClassGroups,
} from '@/lib/backoffice/permissions'
import type { StaffUser } from '@/lib/backoffice/types'
import {
  addBusinessDays,
  businessDaysUntil,
  CERTIFICATE_DEADLINE_BUSINESS_DAYS,
} from '@/lib/backoffice/certificates'
import { formatDate, formatDateTime, type Locale } from '@/lib/format'
import {
  Card,
  Field,
  Meter,
  StatusBadge,
} from '@/components/backoffice/ui'
import { classGroupTone, seatPressureTone } from '@/components/backoffice/status-tone'
import { BoIcon } from '@/components/backoffice/icons'
import { ClassGroupCertificates } from './class-group-certificates'
import { ClassGroupActions } from './class-group-actions'
import { TeacherCell } from '../class-group-table'
import { WaitlistCard } from './waitlist-card'
import { AutoGrid } from '@/components/layout/auto-grid'

type Translate = Awaited<ReturnType<typeof getTranslations<'bo'>>>

/**
 * One class group. A teacher still reads the mock (their scope needs the
 * teachers context, Sessão 36); everyone else reads the catalog API (OOC-35).
 * The certificate deadline is computed here, on the server: doing it in a
 * client component would let the server and the client disagree across a day
 * boundary.
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

  if (isRestrictedToOwnClassGroups(staff.role)) {
    return <TeacherClassGroupDetail staff={staff} classGroupId={classGroupId} locale={locale as Locale} t={t} />
  }

  /* Billing sees no academic data: the page answers 404 (the catalog API
     answers it 403). The role on the route in `apps/api` is what enforces it (CLAUDE.md §8). */
  if (!canBrowseCatalog(staff.role)) notFound()
  const group = await getCatalogClassGroup(classGroupId)
  if (!group) notFound()

  const canManage = canCreateClassGroup(staff.role)

  /* The waitlist carries each student's national id, so the API answers it
     only to who runs class groups (the GET /students rule). Everyone else
     never asks: the card is simply not there, same as a failed read. */
  const [waitlist, courses, teachers] = await Promise.all([
    canManage ? listCatalogWaitlist(group.id) : Promise.resolve(null),
    listCatalogCourses(),
    canManage ? listTeacherOptions() : Promise.resolve(null),
  ])
  const schedule = slotsLabel(group.slots, t)

  /* The free certificate is owed within 25 business days of the end
     (`docs/REGRAS-NEGOCIO.md` §6) — only worth saying once classes are over. */
  const deadline =
    group.status === 'finished' && group.endsOn
      ? addBusinessDays(isoToLimaDate(group.endsOn), CERTIFICATE_DEADLINE_BUSINESS_DAYS)
      : null
  const businessDaysLeft = deadline ? businessDaysUntil(deadline, new Date()) : 0

  const windowSide = (iso: string | null) =>
    iso ? formatDateTime(iso, locale as Locale) : t('class_group.window_open_ended')

  /* A full class group always shows its waitlist, even empty — that is where
     coordination adds the next person. A failed read shows nothing rather than
     a "nobody waiting" that may be false. */
  const showWaitlist =
    waitlist !== null && (group.seatsTaken >= group.capacity || waitlist.length > 0)

  return (
    <div className="flex flex-col gap-5">
      <BackToList t={t} />

      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold tracking-tight text-ink">
              {group.courseName}
            </h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {`${group.language} · ${group.academicPeriodName}`}
            </p>
          </div>
          <span className="flex flex-wrap gap-1.5">
            <StatusBadge
              tone={classGroupTone[group.status]}
              label={t(`class_group_status.${group.status}`)}
            />
            {!group.active && <StatusBadge tone="neutral" label={t('class_groups.retired')} />}
            {!group.courseActive && (
              <StatusBadge tone="warning" label={t('class_groups.course_off_catalog')} />
            )}
          </span>
        </div>

        <AutoGrid as="dl" min="17rem" className="mt-5">
          <Field label={t('class_group.field_code')}>
            <span className="tabular-nums">{group.code}</span>
          </Field>
          <Field label={t('class_group.field_teacher')}>
            <TeacherCell row={group} />
          </Field>
          <Field label={t('class_group.field_schedule')}>
            <span className="tabular-nums">{schedule}</span>
          </Field>
          <Field label={t('class_group.field_start')}>
            {group.startsOn
              ? formatDate(group.startsOn, locale as Locale)
              : t('class_groups.no_dates')}
          </Field>
          <Field label={t('class_group.field_end')}>
            {group.endsOn ? formatDate(group.endsOn, locale as Locale) : t('class_groups.no_dates')}
          </Field>
          <Field label={t('class_group.field_window')}>
            {group.enrollmentOpensAt === null && group.enrollmentClosesAt === null
              ? t('class_group.window_open_ended')
              : `${windowSide(group.enrollmentOpensAt)} – ${windowSide(group.enrollmentClosesAt)}`}
          </Field>
          <SeatsField
            label={t('class_group.field_seats')}
            taken={group.seatsTaken}
            capacity={group.capacity}
          />
        </AutoGrid>

        {deadline && (
          <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-line bg-sky-soft px-4 py-3">
            <span className="flex items-center gap-2 text-sm font-semibold text-ink">
              <BoIcon name="clock" size={16} />
              {t('class_group.deadline_title')}
            </span>
            <span className="text-sm text-ink">
              {t('class_group.deadline_value', {
                // Date only: the deadline is a calendar day, not an instant.
                date: formatDate(deadline.toISOString().slice(0, 10), locale as Locale),
              })}
            </span>
            <StatusBadge
              tone={businessDaysLeft < 0 ? 'danger' : businessDaysLeft <= 5 ? 'warning' : 'info'}
              label={
                businessDaysLeft < 0
                  ? t('class_group.deadline_overdue', { days: -businessDaysLeft })
                  : t('class_group.deadline_left', { days: businessDaysLeft })
              }
            />
          </div>
        )}
      </Card>

      <ClassGroupActions
        group={group}
        courses={courses ?? []}
        teachers={teachers}
        // A retired class group still gets the card: it is where it comes back.
        canManage={canManage}
      />

      {showWaitlist && (
        <WaitlistCard
          group={group}
          entries={waitlist}
          canManage={canManage}
          canEnroll={canCreateEnrollment(staff.role)}
        />
      )}
    </div>
  )
}

/**
 * The teacher's view of one of their class groups — still the mock, unchanged:
 * the roster, grades and certificates have no API yet (Sessão 36).
 *
 * Somebody else's class group answers exactly like one that does not exist.
 * Hiding the link would stop nobody — the id in the URL is guessable
 * (anti-IDOR, CLAUDE.md §8).
 */
function TeacherClassGroupDetail({
  staff,
  classGroupId,
  locale,
  t,
}: {
  staff: StaffUser
  classGroupId: string
  locale: Locale
  t: Translate
}) {
  const group = getClassGroupFor(staff, classGroupId)
  if (!group) notFound()

  const deadline = addBusinessDays(
    group.endDate,
    CERTIFICATE_DEADLINE_BUSINESS_DAYS,
  )
  const businessDaysLeft = businessDaysUntil(deadline, new Date())

  return (
    <div className="flex flex-col gap-5">
      <BackToList t={t} />

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
            {formatDate(group.startDate, locale)}
          </Field>
          <Field label={t('class_group.field_end')}>
            {formatDate(group.endDate, locale)}
          </Field>
          <SeatsField
            label={t('class_group.field_seats')}
            taken={group.seatsTaken}
            capacity={group.capacity}
          />
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

function BackToList({ t }: { t: Translate }) {
  return (
    <Link
      href="/backoffice/class-groups"
      className="inline-flex w-fit items-center gap-1.5 text-sm font-semibold text-muted-foreground transition hover:text-ink"
    >
      <BoIcon name="arrow-left" size={16} />
      {t('class_group.back_to_list')}
    </Link>
  )
}

function SeatsField({
  label,
  taken,
  capacity,
}: {
  label: string
  taken: number
  capacity: number
}) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-0.5 flex flex-col gap-1.5">
        <span className="text-sm font-medium tabular-nums text-ink">
          {`${taken} / ${capacity}`}
        </span>
        <Meter value={taken} max={capacity} tone={seatPressureTone(taken, capacity)} />
      </dd>
    </div>
  )
}
