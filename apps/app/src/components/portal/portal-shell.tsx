'use client'

import { useState, type ReactNode } from 'react'
import Image from 'next/image'
import { useTranslations } from 'next-intl'
import { PortalNav, type NavGroup } from './portal-nav'
import { PortalTabBar } from './portal-tabbar'
import { StudentMenu } from './student-menu'
import { NotificationsBell, type NoticeItem } from './notifications-bell'
import { Icon } from './icons'
import { ProfileSwitcher } from './profile-switcher'
import type { PortalProfile } from '@/lib/portal/types'

/**
 * The portal chrome, client-side because it is stateful: a collapsible
 * sidebar (16rem open, 4rem icons-only) plus the top-right account strip —
 * language, notifications, student menu. Pages stay server components — they
 * arrive as `children`.
 *
 * Two chromes, not one shrunk. On a phone the sidebar is gone and the menu
 * moves to a fixed tab bar at the bottom (`portal-tabbar.tsx`): most of this
 * portal is read standing up, one-handed, and the top of a large phone is the
 * corner a thumb never reaches. What stays at the top there is what gets read
 * rather than pressed — the mark and the bell.
 */

function BrandMark({
  portalLabel,
  mini = false,
  onBlue = false,
}: {
  portalLabel: string
  mini?: boolean
  onBlue?: boolean
}) {
  if (mini) {
    return (
      <Image
        src="/brand/favicon.png"
        alt="Only One Coin"
        width={32}
        height={32}
        className="h-8 w-8"
      />
    )
  }
  return (
    <div className="flex flex-col gap-1">
      <Image
        src="/brand/logo-mark.png"
        alt="Only One Coin"
        width={81}
        height={28}
        className="h-7 w-auto"
      />
      <span
        className={`whitespace-nowrap text-[11px] font-medium ${
          onBlue ? 'text-white/70' : 'text-muted-foreground'
        }`}
      >
        {portalLabel}
      </span>
    </div>
  )
}

export function PortalShell({
  portalLabel,
  navGroups,
  studentName,
  monogram,
  notifications,
  logoutAction,
  profiles,
  currentProfileId,
  selectProfileAction,
  children,
}: {
  portalLabel: string
  navGroups: NavGroup[]
  studentName: string
  monogram: string
  notifications: NoticeItem[]
  logoutAction: () => Promise<void>
  /** Every profile of the account (OOC-147); the switcher shows from two up. */
  profiles: PortalProfile[]
  currentProfileId: string
  selectProfileAction: (formData: FormData) => Promise<void>
  children: ReactNode
}) {
  const t = useTranslations('portal')
  const [collapsed, setCollapsed] = useState(false)
  const toggleLabel = collapsed ? t('nav.expand') : t('nav.collapse')

  const profileSwitcher = (
    <ProfileSwitcher profiles={profiles} currentProfileId={currentProfileId} selectAction={selectProfileAction} />
  )

  const accountStrip = (
    <div className="flex items-center gap-2">
      {profileSwitcher}
      <NotificationsBell notifications={notifications} align="end" />
      <StudentMenu
        name={studentName}
        monogram={monogram}
        logoutAction={logoutAction}
      />
    </div>
  )

  return (
    <div className="min-h-dvh bg-sky-soft text-ink">
      {/* Sidebar — desktop. Brand blue, so it reads as the one colored bar
          on an otherwise light screen. */}
      <aside
        className={`fixed inset-y-0 left-0 z-30 hidden flex-col bg-brand-blue transition-[width] duration-200 ease-in-out lg:flex ${
          collapsed ? 'w-14' : 'w-56'
        }`}
      >
        {/* The toggle rides the sidebar's edge, so it lives in the same spot
            open or closed — never stacked under the logo. */}
        <button
          type="button"
          onClick={() => setCollapsed((prev) => !prev)}
          aria-label={toggleLabel}
          title={toggleLabel}
          className="absolute -right-3 top-5 z-40 grid h-6 w-6 place-items-center rounded-full border border-line bg-white text-muted-foreground shadow-card transition hover:border-brand-blue hover:text-brand-blue"
        >
          <Icon
            name="chevron-right"
            size={13}
            className={`transition-transform duration-200 ${collapsed ? '' : 'rotate-180'}`}
          />
        </button>

        {/* Same height as the content top bar (h-16): the two rules sit side
            by side at the top of the screen, and 17px apart they read as a
            mistake. Change one, change the other. */}
        <div
          className={`flex h-16 shrink-0 items-center border-b border-white/15 ${
            collapsed ? 'justify-center px-2' : 'px-4'
          }`}
        >
          <BrandMark portalLabel={portalLabel} mini={collapsed} onBlue />
        </div>

        <div
          className={`flex-1 overflow-y-auto py-4 ${collapsed ? 'px-2' : 'px-3'}`}
        >
          <PortalNav groups={navGroups} collapsed={collapsed} />
        </div>
      </aside>

      {/* Top bar — mobile / tablet. A marca, o perfil e o sino: o menu, o
          idioma e a saída desceram para a barra de abas. De quem é o portal
          agora (OOC-147) é coisa que se lê em toda tela, então fica no topo —
          e só aparece para a conta com mais de um perfil. */}
      <div className="sticky top-0 z-30 border-b border-line bg-white/90 pt-safe-t backdrop-blur lg:hidden">
        <div className="flex items-center justify-between gap-3 px-4 py-2.5">
          <BrandMark portalLabel={portalLabel} />
          <div className="flex min-w-0 items-center gap-2">
            {profileSwitcher}
            <NotificationsBell notifications={notifications} align="end" />
          </div>
        </div>
      </div>

      {/* Content */}
      <div
        className={`transition-[padding] duration-200 ease-in-out ${
          collapsed ? 'lg:pl-14' : 'lg:pl-56'
        }`}
      >
        {/* Desktop top bar: language, bell and the student's own menu at the
            page's top right — not buried in the sidebar. */}
        <div className="sticky top-0 z-20 hidden h-16 items-center justify-end border-b border-line/60 bg-sky-soft/80 px-6 backdrop-blur lg:flex">
          {accountStrip}
        </div>
        {/* `@container/page` names the reading column. The viewport is the
            wrong ruler once a sidebar sits beside it: the same window yields a
            different column open vs collapsed — which is exactly why screens
            size themselves to the container, not to breakpoints. */}
        {/* O `pb` do celular abre a altura da barra de abas mais a safe area
            — sem isso o último cartão da página fica atrás dela, e a página
            parece ter acabado uma linha antes do que acabou. */}
        <main className="@container/page mx-auto w-full min-w-0 max-w-5xl px-4 pb-[calc(var(--spacing-tabbar)+var(--spacing-safe-b)+1.5rem)] pt-5 sm:px-6 lg:px-10 lg:pb-10 lg:pt-8">
          {children}
        </main>
      </div>

      <PortalTabBar
        groups={navGroups}
        studentName={studentName}
        monogram={monogram}
        logoutAction={logoutAction}
      />
    </div>
  )
}
