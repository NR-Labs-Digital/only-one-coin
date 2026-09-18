import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import Image from 'next/image'
import { cookies } from 'next/headers'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { logoutStaff } from '../actions'
import {
  canBrowseReports,
  canConfigureSettings,
  canManageEmail,
  canManageFeatureFlags,
  canManageStaff,
  isRestrictedToOwnClassGroups,
} from '@/lib/backoffice/permissions'
import {
  getDashboardMetrics,
  getEnrollmentMetrics,
  getTeacher,
} from '@/lib/backoffice/mock-data'
import { getStaffSession } from '@/lib/backoffice/session'
import { getFeatureFlags } from '@/lib/feature-flags/server'
import { initials } from '@/lib/format'
import { BoSidebar, type BoNavGroup } from '@/components/backoffice/bo-sidebar'
import { BoUserMenu } from '@/components/backoffice/bo-user-menu'
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar'
import { Separator } from '@/components/ui/separator'
import { TooltipProvider } from '@/components/ui/tooltip'

/**
 * Backoffice shell. The whole segment stays out of the index (CLAUDE.md §8) —
 * discreet path, never linked from the landing. That is defense in depth, not
 * the defense: real access control is the role check in `apps/api`.
 *
 * Built on the shadcn sidebar primitive: it collapses to an icon rail from the
 * trigger in the header and remembers the choice in a cookie, which is read
 * here so the first server render already matches.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
}

export default async function BackofficePanelLayout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('bo')

  // Whether the panel as a whole is on the air lives in `(gated)/layout.tsx`,
  // not here: this shell renders for `../features` too, off included — that
  // is the one screen the `backoffice` flag must never be able to hide
  // (CLAUDE.md §5).
  const staff = await getStaffSession()
  const { pendingReview } = getDashboardMetrics()
  const { expiringSoon: expiringReservations } = getEnrollmentMetrics()
  const monogram = initials(staff.firstName, staff.lastName)

  // shadcn writes this cookie from the trigger; reading it here avoids the
  // sidebar flashing open before hydration.
  const sidebarOpen = (await cookies()).get('sidebar_state')?.value !== 'false'

  /**
   * A teacher gets the panel narrowed to their own work: their class groups
   * and their own ficha. The money, the student directory and the
   * administration group are not theirs to open — and the sidebar says so by
   * not offering them, rather than by letting the click fail.
   *
   * This is the screen honouring the rule, never enforcing it: the check that
   * counts compares the authenticated `teacher_id` inside the usecase in
   * `apps/api` (CLAUDE.md §8).
   */
  const restricted = isRestrictedToOwnClassGroups(staff.role)

  const flags = await getFeatureFlags()

  /* The teacher's badge is their own queue — the final grades still open
     across their class groups. Same role as the review-queue badge below:
     it is what the panel gets opened for. */
  const pendingGrades =
    restricted && staff.teacherId
      ? (getTeacher(staff.teacherId)?.pendingGrades ?? 0)
      : 0

  /* A group whose every section is off is not an empty dropdown — it is not a
     group. Only `home` is unconditional: it is where the panel starts. */
  const allGroups: BoNavGroup[] = restricted
    ? [
        {
          key: 'home',
          items: [
            { key: 'dashboard', href: '/backoffice/home', label: t('nav.dashboard') },
          ],
        },
        {
          key: 'academic',
          label: t('nav.group_academic'),
          /* The teacher's class groups are the academic section, seen through
             their own scope — so they answer to the same flag as everyone
             else's. Off, the docente panel keeps only its dashboard. */
          items: flags['backoffice.academic']
            ? [
                {
                  key: 'class_groups' as const,
                  href: '/backoffice/class-groups',
                  label: t('nav.my_class_groups'),
                  badge: pendingGrades,
                },
                /* No "Minha ficha" here: what belongs to the reader — their
                   ficha, their account — lives in the user dropdown at the
                   bottom of the rail, not among the work modules. */
              ]
            : [],
        },
      ]
    : [
    {
      /* No label, so it renders loose above the dropdowns. Home is not a
         section of the panel — it is where the panel starts. */
      key: 'home',
      items: [
        { key: 'dashboard', href: '/backoffice/home', label: t('nav.dashboard') },
      ],
    },
    {
      key: 'operations',
      label: t('nav.group_operations'),
      items: [
        ...(flags['backoffice.students']
          ? [
              {
                key: 'students' as const,
                href: '/backoffice/students',
                label: t('nav.students'),
              },
            ]
          : []),
        ...(flags['backoffice.enrollments'] ? [{
          /* One entry for the two screens of the section — the ledger and the
             seats still held by an open payment. The badge is the reservations
             about to expire: a seat nobody chased is a seat the cron hands
             back with the money already paid. */
          key: 'enrollments' as const,
          href: '/backoffice/enrollments',
          label: t('nav.enrollments'),
          badge: expiringReservations,
        }] : []),
        ...(flags['backoffice.payments'] ? [{
          /* One entry for the three screens of the section — the ledger, the
             review queue and the validation parameters. The badge is the queue
             count: what the panel is opened for on a busy day. */
          key: 'payments' as const,
          href: '/backoffice/payments',
          label: t('nav.payments'),
          badge: pendingReview,
        }] : []),
      ],
    },
    {
      key: 'academic',
      label: t('nav.group_academic'),
      items: [
        ...(flags['backoffice.academic'] ? [{
          /* One entry for the two screens the section is made of. They are
             read together — a course is what a class group is an instance of —
             and two sibling items reading "Turmas" and "Cursos" looked like
             the same destination twice. The tab strip on the pages carries
             the split. */
          key: 'class_groups' as const,
          href: '/backoffice/class-groups',
          alsoMatches: ['/backoffice/courses'],
          label: t('nav.academic'),
        }] : []),
        ...(flags['backoffice.teachers']
          ? [
              {
                key: 'teachers' as const,
                href: '/backoffice/teachers',
                label: t('nav.teachers'),
              },
            ]
          : []),
      ],
    },
    {
      key: 'admin',
      label: t('nav.group_admin'),
      items: [
        /* Same rule the whole group follows: an entry that only ever opens
           on a locked state is a door that never opens. The catalog of what
           every student receives belongs to the two roles that answer for the
           funnel; tesorería settles money and a teacher runs a class group.
           Whoever arrives by URL still meets the locked screen, and the role
           on the route in `apps/api` is what enforces it (CLAUDE.md §8). */
        ...(canManageEmail(staff.role) && flags['backoffice.email']
          ? [
              {
                key: 'email' as const,
                href: '/backoffice/emails',
                label: t('nav.email'),
              },
            ]
          : []),
        /* Same rule as settings below: an entry that only ever opens on a
           locked state is a door that never opens. Tesorería reads its figure
           of the ciclo in Pagos, beside the receipts it settles; the teacher's
           narrowed rail never had this group. Whoever arrives by URL still
           meets the locked screen, and the role on the route in `apps/api` is
           what enforces it (CLAUDE.md §8). */
        ...(canBrowseReports(staff.role) && flags['backoffice.reports']
          ? [
              {
                key: 'reports' as const,
                href: '/backoffice/reports',
                label: t('nav.reports'),
              },
            ]
          : []),
        /* Same rule as its neighbours: the team directory is where a cargo
           changes, and the anti-escalation rule gives that to `admin` alone
           (CLAUDE.md §8). Coordination runs the academic side and never
           promotes anybody, so it is not shown a roster whose only actions it
           may not take. */
        ...(canManageStaff(staff.role) && flags['backoffice.staff']
          ? [
              {
                key: 'staff' as const,
                href: '/backoffice/team',
                label: t('nav.staff'),
              },
            ]
          : []),
        /* Settings is admin's alone — it holds the grade that decides who is
           certified and the tolerance the platform approves a receipt with when
           nobody is looking. Left out of the rail rather than shown greyed:
           "pronto" promises a door that will open one day, and this one never
           opens for coordination or tesorería. The locked state on the page
           stays for whoever arrives by URL, and the role on the route in
           `apps/api` is what actually enforces it (CLAUDE.md §8). */
        ...(canConfigureSettings(staff.role) && flags['backoffice.settings']
          ? [
              {
                key: 'settings' as const,
                href: '/backoffice/settings',
                label: t('nav.settings'),
              },
            ]
          : []),
        /* Funcionalidades — which sections of the platform are on the air
           (CLAUDE.md §5). The only entry in the rail gated by an e-mail domain
           instead of a cargo: what the platform admits to existing belongs to
           whoever runs the platform, not to whoever runs the school. And the
           only one with no flag of its own — see the note in
           `lib/feature-flags/registry.ts`. */
        ...(canManageFeatureFlags(staff.email)
          ? [
              {
                key: 'features' as const,
                href: '/backoffice/features',
                label: t('nav.features'),
              },
            ]
          : []),
      ],
    },
  ]

  const groups = allGroups.filter((group) => group.items.length > 0)

  const brand = (
    <div className="flex h-14 items-center gap-2.5 px-2 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
      <span className="grid size-8 shrink-0 place-items-center overflow-hidden rounded-lg bg-white/10 group-data-[collapsible=icon]:bg-transparent">
        <Image
          src="/brand/logo-mark.png"
          alt="Only One Coin"
          width={192}
          height={66}
          className="h-auto w-7"
        />
      </span>
      {/* The mark and the name, nothing under them. "Painel administrativo"
          sat here as a second line and said what the reader had already been
          told twice — by the door they came in through and by the header at
          the top of the page they are on. */}
      <span className="min-w-0 truncate text-[15px] font-semibold text-white group-data-[collapsible=icon]:hidden">
        Only One Coin
      </span>
    </div>
  )

  const footer = (
    /*
      The person's own chip, folded into one dropdown: profile, the teacher's
      own ficha when there is one, and the way out. It lives here rather than
      in a module group because these are the screens of the panel that belong
      to the reader instead of to the institution.
    */
    <BoUserMenu
      name={`${staff.firstName} ${staff.lastName}`}
      roleLabel={t(`role.${staff.role}`)}
      monogram={monogram}
      profileLabel={t('nav.profile')}
      teacherFile={
        restricted && staff.teacherId
          ? {
              href: `/backoffice/teachers/${staff.teacherId}`,
              label: t('nav.my_profile'),
            }
          : null
      }
      logoutLabel={t('nav.logout')}
      logout={logoutStaff}
    />
  )

  return (
    <>
      {/* The sidebar shows a tooltip per item once collapsed to the icon rail. */}
      <TooltipProvider delayDuration={200}>
        <SidebarProvider defaultOpen={sidebarOpen}>
          <BoSidebar
            groups={groups}
            soonLabel={t('nav.soon')}
            a11y={{
              title: t('nav.sidebar_title'),
              description: t('nav.sidebar_description'),
              close: t('nav.sidebar_close'),
              toggle: t('nav.sidebar_toggle'),
            }}
            brand={brand}
            footer={footer}
          />

          <SidebarInset className="bg-background">
            {/* `pt-safe-t`: com `viewportFit: 'cover'` a página pinta sob a
                barra de status do celular, e sem isso o botão do menu fica
                debaixo do relógio do sistema. */}
            <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background/95 px-4 pt-safe-t backdrop-blur">
              <SidebarTrigger
                className="-ml-1 text-muted-foreground"
                label={t('nav.sidebar_toggle')}
              />
              <Separator orientation="vertical" className="mr-1 !h-5" />
              {/*
                No language switch here. It used to sit on the right of every
                screen in the panel, which made a once-a-year choice into
                permanent chrome — and a control that reloads the page under
                someone mid-task. It lives in `/backoffice/account` now, with
                the rest of what a person sets about themselves. The login
                screens keep theirs: before signing in there is no account to
                open, and someone who cannot read Spanish has to switch there.
              */}
              <span className="text-sm font-semibold text-foreground">
                {t('brand.panel_label')}
              </span>
            </header>

            {/*
              The panel is a work surface, not a reading column: it grows with
              the monitor instead of parking a 72rem block in the middle of a
              wide screen while the tables inside it scroll sideways. The cap
              only stops the rows from becoming unscannable on a very wide one.

              `@container/page` names this column so anything below can size
              itself against the space it actually gets. The viewport is the
              wrong ruler here — the same 1280px window gives ~1000px with the
              sidebar open and ~1170px with it collapsed, and a `xl:` rule
              cannot tell those apart.
            */}
            <main className="@container/page mx-auto w-full min-w-0 max-w-[100rem] px-4 pb-[calc(var(--spacing-safe-b)+1.5rem)] pt-6 sm:px-6 lg:px-8">
              {children}
            </main>
          </SidebarInset>
        </SidebarProvider>
      </TooltipProvider>
    </>
  )
}
