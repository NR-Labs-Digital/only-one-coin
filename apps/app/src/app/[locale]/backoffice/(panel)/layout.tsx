import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import Image from 'next/image'
import { cookies } from 'next/headers'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { logoutStaff } from '../actions'
import {
  canBrowseCatalog,
  canBrowseReports,
  canConfigureSettings,
  canViewAuditLog,
  canManageEmail,
  canManageFeatureFlags,
  canManageStaff,
  canViewPayments,
} from '@/lib/backoffice/permissions'
import { getReviewQueueHead } from '@/lib/backoffice/dashboard'
import { getBackofficeSession } from '@/lib/backoffice/session'
import { getFeatureView } from '@/lib/feature-flags/server'
import { isHiddenFromEverybody, surfaceHasHiddenFlags } from '@/lib/feature-flags/resolve'
import type { FeatureFlagKey } from '@/lib/feature-flags/registry'
import { InternalPreviewBadge } from '@/components/internal-preview-badge'
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
  // The session and the flags are independent reads of apps/api — asked
  // together, so the shell pays one round trip for both instead of two. A
  // teacher is sent to the docente portal from inside the session read.
  const [staff, view] = await Promise.all([getBackofficeSession(), getFeatureView('backoffice')])
  const { flags } = view
  // An entry this reader sees only through an unlock — an owners' account or
  // the preview cookie — is marked as off for everybody else (`resolve.ts`).
  const hidden = (key: FeatureFlagKey) => isHiddenFromEverybody(view, key)
  const monogram = initials(staff.firstName, staff.lastName)

  // shadcn writes this cookie from the trigger; reading it here avoids the
  // sidebar flashing open before hydration.
  const sidebarOpen = (await cookies()).get('sidebar_state')?.value !== 'false'

  /* The queue count behind the Payments badge, asked only by a cargo the API
     serves the queue to — anybody else would get a 403, and the badge would
     just say nothing. A failed read says nothing too: no badge beats a wrong
     zero. */
  const reviewQueue =
    flags['backoffice.payments'] && canViewPayments(staff.role)
      ? await getReviewQueueHead()
      : null
  const pendingReview = reviewQueue?.total ?? 0

  /* A group whose every section is off is not an empty dropdown — it is not a
     group. Only `home` is unconditional: it is where the panel starts. */
  const allGroups: BoNavGroup[] = [
    {
      /* No label, so it renders loose above the dropdowns. Home is not a
         section of the panel — it is where the panel starts. */
      key: 'home',
      items: [
        {
          key: 'dashboard',
          href: '/backoffice/home',
          label: t('nav.dashboard'),
          hiddenFromOthers: hidden('backoffice'),
        },
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
                hiddenFromOthers: hidden('backoffice.students'),
              },
            ]
          : []),
        ...(flags['backoffice.enrollments'] ? [{
          key: 'enrollments' as const,
          href: '/backoffice/enrollments',
          label: t('nav.enrollments'),
          hiddenFromOthers: hidden('backoffice.enrollments'),
        }] : []),
        ...(flags['backoffice.payments'] ? [{
          /* One entry for the three screens of the section — the ledger, the
             review queue and the validation parameters. The badge is the queue
             count: what the panel is opened for on a busy day. */
          key: 'payments' as const,
          href: '/backoffice/payments',
          label: t('nav.payments'),
          hiddenFromOthers: hidden('backoffice.payments'),
          badge: pendingReview,
        }] : []),
      ],
    },
    {
      key: 'academic',
      label: t('nav.group_academic'),
      items: [
        ...(flags['backoffice.academic'] && canBrowseCatalog(staff.role) ? [{
          /* One entry for the two screens the section is made of. They are
             read together — a course is what a class group is an instance of —
             and two sibling items reading "Turmas" and "Cursos" looked like
             the same destination twice. The tab strip on the pages carries
             the split. Billing sees no academic data: the catalog API answers
             it 403 (and the pages answer 404), so the link is not drawn either. */
          key: 'class_groups' as const,
          href: '/backoffice/class-groups',
          alsoMatches: ['/backoffice/courses'],
          label: t('nav.academic'),
          hiddenFromOthers: hidden('backoffice.academic'),
        }] : []),
        ...(flags['backoffice.teachers']
          ? [
              {
                key: 'teachers' as const,
                href: '/backoffice/teachers',
                label: t('nav.teachers'),
                hiddenFromOthers: hidden('backoffice.teachers'),
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
                hiddenFromOthers: hidden('backoffice.email'),
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
                hiddenFromOthers: hidden('backoffice.reports'),
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
                hiddenFromOthers: hidden('backoffice.staff'),
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
                hiddenFromOthers: hidden('backoffice.settings'),
              },
            ]
          : []),
        /* The general audit log reads the whole platform's trail, so it is
           shown only to who may read it — management and the analyst. The
           role on the route in `apps/api` is what enforces it (CLAUDE.md §8). */
        ...(canViewAuditLog(staff.role) && flags['backoffice.audit']
          ? [
              {
                key: 'audit' as const,
                href: '/backoffice/audit',
                label: t('nav.audit'),
                hiddenFromOthers: hidden('backoffice.audit'),
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
      teacherFile={null}
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
            hiddenLabel={t('nav.hidden_from_others')}
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
      {/* The owners' account sees what is off for everybody else; the banner
          says so on every screen, the way the preview cookie's does. The
          cookie's own banner is drawn by the root layout, so it is not drawn
          twice here. */}
      {view.unlock === 'owner' && surfaceHasHiddenFlags(view, 'backoffice') && (
        <InternalPreviewBadge mode="owner" />
      )}
    </>
  )
}
