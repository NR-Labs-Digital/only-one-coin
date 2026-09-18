import {
  AlertTriangle,
  Armchair,
  ArrowRight,
  ArrowUpRight,
  ClipboardList,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import {
  getDashboardMetrics,
  getReviewQueue,
  getSeatWatch,
} from '@/lib/backoffice/mock-data'
import { getStaffSession } from '@/lib/backoffice/session'
import { getFeatureFlags } from '@/lib/feature-flags/server'
import { isRestrictedToOwnClassGroups } from '@/lib/backoffice/permissions'
import { formatDate, formatDateTime, formatMoney, type Locale } from '@/lib/format'
import { reviewFlagTone, seatPressureTone } from '@/components/backoffice/status-tone'
import { StatusPill, toneBar } from '@/components/backoffice/status-pill'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Progress } from '@/components/ui/progress'
import { Button } from '@/components/ui/button'
import { TeacherHome } from './teacher-home'
import { AutoGrid } from '@/components/layout/auto-grid'

/**
 * Backoffice home. Two jobs: surface what needs a human right now (the receipt
 * review queue and seat pressure — CLAUDE.md §5) and give one door per module.
 * Every number comes from the mock source; no backend is wired yet.
 */
export default async function BackofficeHomePage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale: raw } = await params
  const locale = raw as Locale
  setRequestLocale(raw)
  const t = await getTranslations('bo')

  const staff = await getStaffSession()

  /* A teacher gets their own home, not this one with the money removed — see
     `TeacherHome` for why it is a separate screen. */
  if (isRestrictedToOwnClassGroups(staff.role)) {
    return <TeacherHome staff={staff} locale={locale} />
  }

  const flags = await getFeatureFlags()
  const metrics = getDashboardMetrics()
  const queue = getReviewQueue()
  const seats = getSeatWatch()

  const seatPct =
    metrics.seatsCapacity === 0
      ? 0
      : Math.round((metrics.seatsTaken / metrics.seatsCapacity) * 100)

  const stats: {
    label: string
    value: string
    hint: string
    icon: LucideIcon
    accent: string
  }[] = [
    {
      label: t('dashboard.metric_enrollments_today'),
      value: String(metrics.enrollmentsToday),
      hint: t('dashboard.metric_delta', { value: metrics.enrollmentsTodayDelta }),
      icon: ClipboardList,
      accent: 'bg-sky text-brand-blue',
    },
    {
      label: t('dashboard.metric_pending_review'),
      value: String(metrics.pendingReview),
      hint: t('dashboard.metric_oldest', { hours: metrics.oldestPendingHours }),
      icon: AlertTriangle,
      accent: 'bg-amber-50 text-amber-600',
    },
    {
      label: t('dashboard.metric_active_students'),
      value: String(metrics.activeStudents),
      hint: t('dashboard.metric_delta', { value: metrics.activeStudentsDelta }),
      icon: Users,
      accent: 'bg-emerald-50 text-emerald-600',
    },
    {
      label: t('dashboard.metric_seats'),
      value: `${seatPct}%`,
      hint: t('dashboard.metric_seats_hint', {
        taken: metrics.seatsTaken,
        capacity: metrics.seatsCapacity,
      }),
      icon: Armchair,
      accent: 'bg-cream text-brand-yellow-deep',
    },
  ]

  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
          {t('dashboard.greeting', { name: staff.firstName })}
        </h1>
      </header>

      {/* Headline numbers */}
      <AutoGrid as="section" min="15rem" gap="gap-3">
        {stats.map(({ label, value, hint, icon: Icon, accent }) => (
          <Card key={label} className="gap-0 py-4">
            <CardContent className="flex items-start justify-between gap-3 px-4">
              <div className="min-w-0">
                <p className="truncate text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {label}
                </p>
                <p className="mt-1.5 text-3xl font-semibold tracking-tight text-foreground">
                  {value}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
              </div>
              <span className={`grid size-9 shrink-0 place-items-center rounded-lg ${accent}`}>
                <Icon className="size-4.5" />
              </span>
            </CardContent>
          </Card>
        ))}
      </AutoGrid>

      {/* Human review queue — the core of the backoffice (CLAUDE.md §5). It is
          Pagos seen from the door, so it answers to that flag: with the section
          off, the panel does not advertise a pile of work nobody can open. */}
      {flags['backoffice.payments'] && (
        <section>
          <Card className="gap-0 overflow-hidden py-0">
            <CardHeader className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
              <div>
                <CardTitle className="flex items-center gap-2 text-base font-semibold">
                  <AlertTriangle className="size-4 text-amber-500" />
                  {t('review.title')}
                </CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t('review.subtitle')}
                </p>
              </div>
              {/* Contador e porta são a mesma coisa: o número é o que chama, a
                  seta diz que dá pra ir. */}
              <Button asChild size="lg" className="shrink-0 font-semibold">
                <Link href="/backoffice/payments/review" aria-label={t('review.see_all')}>
                  {t('review.pending_count', { count: metrics.pendingReview })}
                  <ArrowRight data-icon="inline-end" />
                </Link>
              </Button>
            </CardHeader>

            <CardContent className="px-0">
              {queue.length === 0 ? (
                <div className="px-5 py-8 text-center">
                  <p className="text-sm font-semibold text-foreground">
                    {t('review.empty_title')}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {t('review.empty_body')}
                  </p>
                </div>
              ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="pl-5">{t('review.col_student')}</TableHead>
                      <TableHead>{t('review.col_course')}</TableHead>
                      <TableHead>{t('review.col_amount')}</TableHead>
                      <TableHead>{t('review.col_flag')}</TableHead>
                      <TableHead>{t('review.col_submitted')}</TableHead>
                      <TableHead className="pr-5 text-right">
                        <span className="sr-only">{t('common.actions')}</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {queue.map((item) => {
                      const mismatch = item.amountCents !== item.expectedAmountCents
                      return (
                        <TableRow key={item.id}>
                          <TableCell className="whitespace-nowrap pl-5 font-medium">
                            {item.studentName}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-muted-foreground">
                            {item.courseName}
                          </TableCell>
                          <TableCell>
                            <span className="flex flex-col leading-tight">
                              <span
                                className={`font-semibold tabular-nums ${
                                  mismatch ? 'text-destructive' : ''
                                }`}
                              >
                                {formatMoney(item.amountCents, 'PEN', locale)}
                              </span>
                              {mismatch && (
                                <span className="text-xs text-muted-foreground">
                                  {t('review.expected', {
                                    amount: formatMoney(
                                      item.expectedAmountCents,
                                      'PEN',
                                      locale,
                                    ),
                                  })}
                                </span>
                              )}
                            </span>
                          </TableCell>
                          <TableCell>
                            <StatusPill
                              tone={reviewFlagTone[item.flag]}
                              label={t(`review_flag.${item.flag}`)}
                            />
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                            {formatDateTime(item.submittedAt, locale)}
                          </TableCell>
                          <TableCell className="pr-5 text-right">
                            {/* The row still says what is waiting; the way into
                                the ficha exists only while that section does. */}
                            {flags['backoffice.students'] && (
                              <Button asChild variant="outline" size="sm">
                                <Link
                                  href={`/backoffice/students/${item.studentId}`}
                                  className="font-semibold text-primary"
                                >
                                  {t('review.open_file')}
                                  <ArrowUpRight data-icon="inline-end" />
                                </Link>
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
              )}

              {/* The door to the queue is the counter in the header — one per
                  card, or the eye stops trusting either. */}
              {queue.length > 0 && (
                <div className="border-t border-border px-5 py-3">
                  <p className="text-xs text-muted-foreground">
                    {t('review.showing', {
                      shown: queue.length,
                      total: metrics.pendingReview,
                    })}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </section>
      )}

      {/* Seat pressure per class group — the academic section summed up, and
          off with it: there would be nothing behind these cards to open. */}
      {flags['backoffice.academic'] && (
        <section>
          <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
                <Armchair className="size-4 text-brand-blue" />
                {t('seats.title')}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">{t('seats.subtitle')}</p>
            </div>
            {/* A lista mostra só as aulas mais cheias; a porta pro resto fica aqui. */}
            <Link
              href="/backoffice/courses"
              className="inline-flex items-center gap-1 text-xs font-semibold text-primary transition hover:underline"
            >
              {t('seats.see_all')}
              <ArrowRight className="size-3.5" />
            </Link>
          </div>
          <AutoGrid min="20rem" gap="gap-3">
            {seats.map((group) => {
              const tone = seatPressureTone(group.seatsTaken, group.capacity)
              const full = group.seatsTaken >= group.capacity
              const pct = Math.round((group.seatsTaken / group.capacity) * 100)
              return (
                <Card key={group.id} className="gap-0 py-4">
                  <CardContent className="px-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{group.courseName}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {group.classGroupName}
                        </p>
                      </div>
                      <StatusPill
                        tone={tone}
                        dot={false}
                        label={
                          full
                            ? t('seats.full')
                            : t('seats.available', {
                                count: group.capacity - group.seatsTaken,
                              })
                        }
                      />
                    </div>
                    <Progress
                      value={pct}
                      className="mt-3 h-1.5 bg-secondary"
                      indicatorClassName={toneBar[tone]}
                    />
                    <div className="mt-1.5 flex items-center justify-between text-xs text-muted-foreground">
                      <span>
                        {t('seats.taken', {
                          taken: group.seatsTaken,
                          capacity: group.capacity,
                        })}
                      </span>
                      <span>
                        {t('seats.starts', { date: formatDate(group.startDate, locale) })}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </AutoGrid>
        </section>
      )}

    </div>
  )
}
