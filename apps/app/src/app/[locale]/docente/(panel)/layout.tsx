import type { ReactNode } from 'react'
import Image from 'next/image'
import { cookies } from 'next/headers'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { logoutTeacher } from '../actions'
import { getTeacherSession } from '@/lib/backoffice/session'
import { getFeatureView } from '@/lib/feature-flags/server'
import { isHiddenFromEverybody, surfaceHasHiddenFlags } from '@/lib/feature-flags/resolve'
import { initials } from '@/lib/format'
import { InternalPreviewBadge } from '@/components/internal-preview-badge'
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
 * The docente portal's shell. Its own surface, not the backoffice with the
 * rail narrowed: its own address, its own login, and a menu that only knows
 * the teacher's work — their class groups, their agenda, their ficha. Nothing
 * of the administration is linked from here, so there is nothing to hide.
 *
 * Same building blocks as the backoffice (sidebar primitive, user menu), on
 * purpose: one design system, two doors. Who gets in is the role on the
 * session, checked by `getTeacherSession()` server-side; anybody else is sent
 * to the backoffice (CLAUDE.md §8). The check that counts is still the role
 * on each route in `apps/api`.
 */
export default async function TeacherPanelLayout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('bo')

  // Independent reads of apps/api, memoized per request — asked together.
  const [staff, view] = await Promise.all([getTeacherSession(), getFeatureView('teacher')])
  const { flags } = view
  const sidebarOpen = (await cookies()).get('sidebar_state')?.value !== 'false'

  /* No badge on "My class groups" yet: what it would count — the final
     grades still open — has no API until OOC-38. A zero would say "nothing
     owed" about something nobody can record. */

  const groups: BoNavGroup[] = [
    {
      key: 'home',
      items: [
        {
          key: 'dashboard',
          href: '/docente/home',
          label: t('nav.dashboard'),
          hiddenFromOthers: isHiddenFromEverybody(view, 'teacher'),
        },
      ],
    },
    {
      key: 'teaching',
      label: t('teacher_portal.nav_group'),
      items: [
        {
          key: 'class_groups',
          href: '/docente/class-groups',
          label: t('nav.my_class_groups'),
          hiddenFromOthers: isHiddenFromEverybody(view, 'teacher'),
        },
        ...(flags['teacher.agenda']
          ? [
              {
                key: 'agenda' as const,
                href: '/docente/agenda',
                label: t('nav.agenda'),
                hiddenFromOthers: isHiddenFromEverybody(view, 'teacher.agenda'),
              },
            ]
          : []),
      ],
    },
  ]

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
      {/* Stacked, not side by side: on one line the badge left the name no
          room and it truncated to "Only One…". */}
      <span className="flex min-w-0 flex-col items-start gap-1 leading-none group-data-[collapsible=icon]:hidden">
        <span className="truncate text-[15px] font-semibold text-white">Only One Coin</span>
        {/* The one mark that says which door this is — the backoffice has
            none, the docente portal always carries it. */}
        <span className="rounded-full bg-brand-yellow px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-ink">
          {t('teacher_portal.badge')}
        </span>
      </span>
    </div>
  )

  const footer = (
    <BoUserMenu
      name={`${staff.firstName} ${staff.lastName}`}
      roleLabel={t(`role.${staff.role}`)}
      monogram={initials(staff.firstName, staff.lastName)}
      profileLabel={t('nav.profile')}
      accountHref="/docente/account"
      teacherFile={{ href: '/docente/profile', label: t('nav.my_profile') }}
      logoutLabel={t('nav.logout')}
      logout={logoutTeacher}
    />
  )

  return (
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
          <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background/95 px-4 pt-safe-t backdrop-blur">
            <SidebarTrigger
              className="-ml-1 text-muted-foreground"
              label={t('nav.sidebar_toggle')}
            />
            <Separator orientation="vertical" className="mr-1 !h-5" />
            <span className="text-sm font-semibold text-foreground">
              {t('teacher_portal.panel_label')}
            </span>
          </header>

          {/* Same column rules as the backoffice: `@container/page` so the
              screens size against the space they get, `min-w-0` so a wide
              cell never drags the page sideways (`apps/app/CLAUDE.md`). */}
          <main className="@container/page mx-auto w-full min-w-0 max-w-[100rem] px-4 pb-[calc(var(--spacing-safe-b)+1.5rem)] pt-6 sm:px-6 lg:px-8">
            {children}
          </main>
        </SidebarInset>
      </SidebarProvider>
      {/* Same banner as the backoffice's: an owners' account sees what is off
          for every teacher (`lib/feature-flags/resolve.ts`) — the grade sheet
          that writes only on screen among it — and is told so on every
          screen. The preview cookie's banner comes from the root layout. */}
      {view.unlock === 'owner' && surfaceHasHiddenFlags(view, 'teacher') && (
        <InternalPreviewBadge mode="owner" />
      )}
    </TooltipProvider>
  )
}
