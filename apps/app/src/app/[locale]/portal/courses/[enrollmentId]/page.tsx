import { notFound } from 'next/navigation'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { getPortalView } from '@/lib/portal/session'
import { getFeatureFlags } from '@/lib/feature-flags/server'
import { formatDate, formatMoney } from '@/lib/portal/format'
import type { CourseMaterial, Locale } from '@/lib/portal/types'
import { Card, Field, SectionTitle, StatusBadge } from '@/components/portal/ui'
import { enrollmentTone, moduleTone, paymentTone } from '@/components/portal/status-tone'
import { Icon, type IconName } from '@/components/portal/icons'

const materialIcon: Record<CourseMaterial['kind'], IconName> = {
  doc: 'doc',
  video: 'video',
  audio: 'audio',
  link: 'external',
}

export default async function CourseDetailPage({
  params,
}: {
  params: Promise<{ locale: string; enrollmentId: string }>
}) {
  const { locale: raw, enrollmentId } = await params
  const locale = raw as Locale
  setRequestLocale(raw)
  const t = await getTranslations('portal')

  const flags = await getFeatureFlags('portal')
  // Looked up among the student's own enrollments only — an id from the URL
  // that is not theirs is a 404, never someone else's course (CLAUDE.md §8).
  const { enrollments } = await getPortalView()
  const enrollment = enrollments.find((e) => e.id === enrollmentId)
  if (!enrollment) notFound()

  const { course, classGroup, plan, academicPeriod, monthly } = enrollment
  const locked = enrollment.classAccessLock !== null

  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/portal/courses"
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground transition hover:text-ink"
      >
        <Icon name="arrow-left" size={16} />
        {t('common.back')}
      </Link>

      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
            {course.name}
          </h1>
          <StatusBadge
            tone={enrollmentTone[enrollment.status]}
            label={t(`enrollment_status.${enrollment.status}`)}
          />
        </div>
      </header>

      <div className="grid gap-6 @4xl/page:grid-cols-3">
        <div className="flex flex-col gap-6 @4xl/page:col-span-2">
          {/* About — blank on courses opened since OOC-107, which no longer ask for it */}
          {course.summary.trim() !== '' && (
            <Card className="p-5 sm:p-6">
              <SectionTitle>{t('course_detail.about_title')}</SectionTitle>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {course.summary}
              </p>
            </Card>
          )}

          {/* Schedule & class access */}
          <Card className="p-5 sm:p-6">
            <SectionTitle>{t('course_detail.schedule_title')}</SectionTitle>
            <ul className="mt-3 flex flex-col gap-2">
              {classGroup.schedule.map((slot, i) => (
                <li
                  key={i}
                  className="flex items-center gap-3 rounded-xl bg-sky-soft px-3 py-2.5 text-sm"
                >
                  <span className="text-brand-blue">
                    <Icon name="clock" size={18} />
                  </span>
                  <span className="font-semibold text-ink">
                    {t(`weekday_short.${slot.weekday}`)}
                  </span>
                  <span className="text-muted-foreground">
                    {slot.startTime}–{slot.endTime}
                  </span>
                </li>
              ))}
            </ul>
            {classGroup.startDate && classGroup.endDate && (
              <p className="mt-3 text-xs text-muted-foreground">
                {t('course_detail.period_dates', {
                  start: formatDate(classGroup.startDate, locale),
                  end: formatDate(classGroup.endDate, locale),
                })}
              </p>
            )}
            <div className="mt-4">
              {/* The cadeado (CLAUDE.md §1): the lock is this portal option,
                  never a Classroom integration. */}
              {locked ? (
                <div className="flex flex-col items-start gap-3 rounded-xl border border-red-600/20 bg-red-50 p-4">
                  <p className="flex items-start gap-2 text-sm text-red-800">
                    <span className="mt-0.5 shrink-0">
                      <Icon name="lock" size={16} />
                    </span>
                    {t(`course_detail.locked.${enrollment.classAccessLock}`)}
                  </p>
                  {/* The reason for the padlock is told either way; the
                      button only exists while Pagos does (CLAUDE.md §5). */}
                  {enrollment.classAccessLock === 'monthly_payment_due' &&
                    flags['portal.payments'] && (
                      <Link
                        href="/portal/payments"
                        className="inline-flex items-center gap-2 rounded-full bg-brand-blue px-4 py-2 text-sm font-bold text-white shadow-card transition hover:bg-brand-yellow hover:text-ink"
                      >
                        <Icon name="card" size={16} />
                        {t('course_detail.locked_cta')}
                      </Link>
                    )}
                </div>
              ) : classGroup.classroomUrl ? (
                <a
                  href={classGroup.classroomUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-full bg-brand-blue px-5 py-2.5 text-sm font-bold text-white shadow-card transition hover:bg-brand-yellow hover:text-ink"
                >
                  <Icon name="video" size={18} />
                  {t('course_detail.join_class')}
                </a>
              ) : (
                <p className="inline-flex items-center gap-2 rounded-xl bg-brand-yellow/10 px-3.5 py-2.5 text-xs font-medium text-ink">
                  <span className="text-brand-yellow-deep">
                    <Icon name="clock" size={16} />
                  </span>
                  {t('course_detail.meeting_pending')}
                </p>
              )}
            </div>
          </Card>

          {/* Modules — progression happens in batch, decided by the
              coordination (CLAUDE.md §1); the portal only shows where the
              student stands. */}
          {enrollment.modules.length > 0 && (
            <Card className="p-5 sm:p-6">
              <SectionTitle>{t('course_detail.modules_title')}</SectionTitle>
              <ul className="mt-3 flex flex-col gap-2">
                {enrollment.modules.map((m) => {
                  const modulePayment =
                    monthly?.payments.find((mp) => mp.moduleId === m.id) ?? null
                  return (
                    <li
                      key={m.id}
                      className={`flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-xl border px-3.5 py-3 ${
                        m.status === 'current'
                          ? 'border-brand-blue/40 bg-sky'
                          : 'border-line bg-white'
                      }`}
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-ink">{m.name}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {t('course_detail.period_dates', {
                            start: formatDate(m.startDate, locale),
                            end: formatDate(m.endDate, locale),
                          })}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {monthly !== null &&
                          modulePayment !== null &&
                          (modulePayment.payment === null ? (
                            <StatusBadge
                              tone="danger"
                              label={t('course_detail.month_unpaid')}
                            />
                          ) : (
                            <StatusBadge
                              tone={paymentTone[modulePayment.payment.status]}
                              label={t(
                                `payment_status.${modulePayment.payment.status}`,
                              )}
                            />
                          ))}
                        <StatusBadge
                          tone={moduleTone[m.status]}
                          label={t(`module_status.${m.status}`)}
                          dot={false}
                        />
                      </div>
                    </li>
                  )
                })}
              </ul>
            </Card>
          )}

          {/* Materials */}
          <Card className="p-5 sm:p-6">
            <SectionTitle>{t('course_detail.materials_title')}</SectionTitle>
            {course.materials.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">
                {t('course_detail.materials_empty')}
              </p>
            ) : (
              <ul className="mt-3 flex flex-col gap-2">
                {course.materials.map((m) => (
                  <li key={m.id}>
                    <a
                      href={m.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group flex items-center gap-3 rounded-xl border border-line px-3.5 py-3 transition hover:border-brand-blue/40 hover:bg-sky-soft"
                    >
                      <span className="grid h-9 w-9 place-items-center rounded-lg bg-sky text-brand-blue">
                        <Icon name={materialIcon[m.kind]} size={18} />
                      </span>
                      <span className="flex-1 text-sm font-medium text-ink">
                        {m.title}
                      </span>
                      <span className="text-muted-foreground transition group-hover:text-brand-blue">
                        <Icon name="external" size={16} />
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        {/* Side: teacher + result + plan */}
        <div className="flex flex-col gap-6">
          <Card className="p-5 sm:p-6">
            <SectionTitle>{t('course_detail.teacher_title')}</SectionTitle>
            <div className="mt-3 flex items-center gap-3">
              <span className="grid h-11 w-11 place-items-center rounded-full bg-sky text-brand-blue">
                <Icon name="profile" size={22} />
              </span>
              <span className="text-sm font-semibold text-ink">
                {classGroup.teacherName}
              </span>
            </div>
          </Card>

          {/* Final grade — only once the class group closed. */}
          {enrollment.status === 'completed' && enrollment.finalGrade !== null && (
            <Card className="p-5 sm:p-6">
              <SectionTitle>{t('course_detail.result_title')}</SectionTitle>
              {enrollment.finalGrade === 'did_not_attempt' ? (
                <p className="mt-3 text-sm text-muted-foreground">
                  {t('course_detail.result_did_not_attempt')}
                </p>
              ) : (
                <>
                  <p className="mt-3 text-3xl font-bold tracking-tight text-ink">
                    {enrollment.finalGrade}
                    <span className="text-base font-semibold text-muted-foreground">
                      {' '}
                      {t('course_detail.result_grade_scale')}
                    </span>
                  </p>
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    {enrollment.finalGrade >= 14
                      ? t('course_detail.result_pass_note')
                      : t('course_detail.result_fail_note')}
                  </p>
                </>
              )}
            </Card>
          )}

          <Card className="p-5 sm:p-6">
            <SectionTitle>{t('course_detail.plan_title')}</SectionTitle>
            <dl className="mt-3 flex flex-col gap-3">
              <Field label={t('enrollments.plan_label')}>{plan.name}</Field>
              <Field label={t('enrollments.billing_label')}>
                {t(`billing_mode.${enrollment.billingMode}`)}
              </Field>
              {monthly !== null ? (
                <Field label={t('course_detail.module_price')}>
                  <span className="text-lg text-ink">
                    {formatMoney(monthly.modulePriceCents, monthly.currency, locale)}
                  </span>
                </Field>
              ) : (
                <Field label={t('course_detail.plan_price')}>
                  <span className="text-lg text-ink">
                    {formatMoney(plan.priceCents, plan.currency, locale)}
                  </span>
                </Field>
              )}
              <Field label={t('common.period')}>{academicPeriod.name}</Field>
              {/* The course's own facts — how it runs, which level, who it is
                  for. They were chips beside the title, where they read as
                  decoration; here they sit with the rest of what was bought. */}
              <Field label={t('course_detail.level_label')}>{course.level}</Field>
              <Field label={t('course_detail.min_age_label')}>
                {t('course_detail.min_age_value', { age: course.minAge })}
              </Field>
              <Field label={t('course_detail.mode_label')}>
                {t('common.online_label')}
              </Field>
            </dl>
            <p className="mt-3 border-t border-line pt-3 text-xs text-muted-foreground">
              {t('course_detail.enrolled_on', {
                date: formatDate(enrollment.createdAt, locale),
              })}
            </p>
          </Card>
        </div>
      </div>
    </div>
  )
}
