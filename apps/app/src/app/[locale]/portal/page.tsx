import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { getPortalView } from '@/lib/portal/session'
import { getFeatureFlags } from '@/lib/feature-flags/server'
import { formatDateTime } from '@/lib/portal/format'
import type { Locale } from '@/lib/portal/types'
import { Card, ProgressBar, SectionTitle, StatusBadge } from '@/components/portal/ui'
import { enrollmentTone } from '@/components/portal/status-tone'
import { Icon, type IconName } from '@/components/portal/icons'
import { AutoGrid } from '@/components/layout/auto-grid'

/**
 * Dashboard: greeting, the blue next-class bar, the courses right under it,
 * then quick actions. Notices live in the bell (top right), not here.
 */
export default async function DashboardPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale: raw } = await params
  const locale = raw as Locale
  setRequestLocale(raw)
  const t = await getTranslations('portal')

  const flags = await getFeatureFlags('portal')
  const { student, enrollments, nextClass } = await getPortalView()
  const current = enrollments.filter((e) => e.status !== 'completed')

  /* An action whose section is off is not a greyed card — it is not an
     action. The dashboard only ever offers doors that open. */
  const quickActions: { href: string; label: string; icon: IconName }[] = [
    ...(flags['portal.payments']
      ? [{ href: '/portal/payments', label: t('dashboard.action_payments'), icon: 'card' as const }]
      : []),
    ...(flags['portal.documents']
      ? [
          {
            href: '/portal/documents',
            label: t('dashboard.action_requests'),
            icon: 'clipboard' as const,
          },
          {
            href: '/portal/documents',
            label: t('dashboard.action_documents'),
            icon: 'documents' as const,
          },
        ]
      : []),
    { href: '/portal/profile', label: t('dashboard.action_profile'), icon: 'profile' },
  ]

  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
          {t('greeting.hello', { name: student.firstName })}
        </h1>
      </header>

      {/* Next class — first thing on the page. Brand blue; the join button is
          white and turns yellow under the cursor. */}
      <section className="-mt-2">
        <div className="mb-3">
          <SectionTitle>{t('next_class.title')}</SectionTitle>
        </div>
        {nextClass ? (
          <Card className="overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-4 bg-brand-blue p-5 text-white sm:p-6">
              <div className="flex flex-col gap-1">
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-white/80">
                  <Icon name="calendar" size={16} />
                  {formatDateTime(nextClass.startsAt, locale)}
                </span>
                <span className="text-xl font-semibold">
                  {nextClass.courseName}
                </span>
                {/* Topics, not running text: one line per fact, each with its
                    own icon bullet. */}
                <ul className="mt-1 flex flex-col gap-1.5 text-sm text-white/85">
                  <li className="flex items-center gap-2">
                    <span className="shrink-0 text-white/70">
                      <Icon name="clock" size={15} />
                    </span>
                    {nextClass.classGroupName}
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="shrink-0 text-white/70">
                      <Icon name="profile" size={15} />
                    </span>
                    {nextClass.teacherName}
                  </li>
                </ul>
              </div>
              {nextClass.classAccessLock !== null ? (
                /* The padlock is the truth either way — what changes with the
                   flag is whether there is a Pagos to send the student to. */
                flags['portal.payments'] ? (
                  <Link
                    href="/portal/payments"
                    className="inline-flex shrink-0 items-center gap-2 rounded-full bg-white/15 px-4 py-2 text-xs font-semibold text-white transition hover:bg-white/25"
                  >
                    <Icon name="lock" size={16} />
                    {t('next_class.locked')}
                  </Link>
                ) : (
                  <span className="inline-flex shrink-0 items-center gap-2 rounded-full bg-white/15 px-4 py-2 text-xs font-semibold text-white">
                    <Icon name="lock" size={16} />
                    {t('next_class.locked')}
                  </span>
                )
              ) : nextClass.classroomUrl ? (
                <a
                  href={nextClass.classroomUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex shrink-0 items-center justify-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-bold text-brand-blue-deep shadow-card transition hover:bg-brand-yellow hover:text-ink"
                >
                  <Icon name="video" size={18} />
                  {t('next_class.join')}
                </a>
              ) : (
                <span className="inline-flex shrink-0 items-center gap-2 rounded-full bg-white/15 px-4 py-2 text-xs font-semibold text-white/85">
                  <Icon name="clock" size={16} />
                  {t('next_class.no_link_yet')}
                </span>
              )}
            </div>
          </Card>
        ) : (
          <Card className="flex flex-col items-start gap-1 p-6">
            <p className="text-base font-semibold text-ink">
              {t('next_class.none_title')}
            </p>
            <p className="text-sm text-muted-foreground">{t('next_class.none_body')}</p>
          </Card>
        )}
      </section>

      {/* My courses — right under the blue bar. */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <SectionTitle>{t('dashboard.my_courses_title')}</SectionTitle>
          {flags['portal.courses'] && (
            <Link
              href="/portal/courses"
              className="inline-flex items-center gap-1 text-sm font-semibold text-brand-blue transition hover:text-brand-blue-deep"
            >
              {t('common.see_all')}
              <Icon name="chevron-right" size={16} />
            </Link>
          )}
        </div>
        <AutoGrid min="18rem">
          {current.map((e) => (
            <Card key={e.id} as="article" className="flex flex-col gap-3 p-5">
              {/* Just the name. Active is the normal state, so it earns no
                  badge — only the exceptions speak up below. */}
              <div className="flex items-start justify-between gap-3">
                <h3 className="text-base font-semibold text-ink">
                  {e.course.name}
                </h3>
                {e.status !== 'active' && e.status !== 'under_review' && (
                  <StatusBadge
                    tone={enrollmentTone[e.status]}
                    label={t(`enrollment_status.${e.status}`)}
                  />
                )}
              </div>
              {e.classAccessLock !== null && (
                <p className="flex items-center gap-1.5 text-xs font-semibold text-red-600">
                  <Icon name="lock" size={13} className="shrink-0" />
                  {t(`access_lock.${e.classAccessLock}`)}
                </p>
              )}
              {e.status === 'under_review' ? (
                <div className="flex flex-col gap-1.5">
                  <ProgressBar
                    value={100}
                    tone="warning"
                    locked
                    label={t('dashboard.progress_label')}
                  />
                  {/* The state lives with the bar, not as a badge upstairs. */}
                  <p className="flex items-center gap-1.5 text-xs font-medium text-brand-yellow-deep">
                    <Icon name="clock" size={13} className="shrink-0" />
                    {t('enrollment_status.under_review')}
                  </p>
                </div>
              ) : (
                e.progressPct !== null && (
                  <ProgressBar
                    value={e.progressPct}
                    tone={e.classAccessLock !== null ? 'danger' : 'default'}
                    locked={e.classAccessLock !== null}
                    label={t('dashboard.progress_label')}
                  />
                )
              )}
              {/* The card stays — it is the student's own course. What the
                  flag governs is whether there is a detail screen behind it. */}
              {flags['portal.courses'] && (
                <Link
                  href={`/portal/courses/${e.id}`}
                  className="mt-1 inline-flex items-center gap-1 text-sm font-semibold text-brand-blue transition hover:text-brand-blue-deep"
                >
                  {t('common.view_detail')}
                  <Icon name="arrow-right" size={16} />
                </Link>
              )}
            </Card>
          ))}
        </AutoGrid>
      </section>

      {/* Quick actions */}
      <section>
        <div className="mb-3">
          <SectionTitle>{t('dashboard.quick_actions_title')}</SectionTitle>
        </div>
        <AutoGrid min="14rem" gap="gap-3">
          {quickActions.map((a) => (
            <Link
              key={a.href}
              href={a.href}
              className="group flex items-center gap-3 rounded-2xl border border-line bg-white p-4 shadow-card transition hover:border-brand-blue/40 hover:bg-sky-soft"
            >
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-sky text-brand-blue transition group-hover:bg-brand-blue group-hover:text-white">
                <Icon name={a.icon} size={20} />
              </span>
              <span className="text-sm font-semibold text-ink">{a.label}</span>
              <Icon
                name="chevron-right"
                size={16}
                className="ml-auto text-muted-foreground"
              />
            </Link>
          ))}
        </AutoGrid>
      </section>
    </div>
  )
}
