'use client'

import { useTranslations } from 'next-intl'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { initials } from '@/lib/portal/format'
import type { PortalProfile } from '@/lib/portal/types'
import { Icon } from './icons'

/**
 * Whose portal this is right now (OOC-147). A guardian's account has one
 * profile per child, and every screen below is about one of them — so the
 * name sits in the top bar, always visible, and opens the list to switch.
 *
 * Not rendered for an account with a single profile: an adult student, or a
 * guardian with one child, sees the portal exactly as before.
 *
 * Each row is a form posting to the server action, so switching works before
 * the page hydrates and never trusts this component: the API checks the id
 * against the session's account on every read.
 */
export function ProfileSwitcher({
  profiles,
  currentProfileId,
  selectAction,
}: {
  profiles: PortalProfile[]
  currentProfileId: string
  selectAction: (formData: FormData) => Promise<void>
}) {
  const t = useTranslations('portal.profile_switcher')
  if (profiles.length < 2) return null
  const current = profiles.find((profile) => profile.id === currentProfileId) ?? profiles[0]!

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t('trigger_label', { name: current.firstName })}
        className="flex h-10 min-w-0 max-w-[12rem] items-center gap-2 rounded-full border border-line bg-white py-1 pl-1 pr-3 text-sm font-medium text-ink transition hover:border-brand-blue/50 data-[state=open]:border-brand-blue/50"
      >
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-sky text-xs font-semibold text-brand-blue-deep">
          {initials(current.firstName, current.lastName)}
        </span>
        <span className="truncate">{current.firstName}</span>
        <Icon name="chevron-right" size={14} className="shrink-0 rotate-90 text-muted-foreground" />
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-72 p-1.5">
        <DropdownMenuLabel className="px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {t('heading')}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {profiles.map((profile) => {
          const selected = profile.id === current.id
          return (
            <form key={profile.id} action={selectAction}>
              <input type="hidden" name="profileId" value={profile.id} />
              <DropdownMenuItem asChild className="gap-3 px-3 py-2.5 text-sm">
                <button type="submit" className="w-full" aria-current={selected ? 'true' : undefined}>
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-sky text-xs font-semibold text-brand-blue-deep">
                    {initials(profile.firstName, profile.lastName)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-left">
                    {profile.firstName} {profile.lastName}
                  </span>
                  {selected ? (
                    <>
                      <Icon name="check" size={16} className="shrink-0 text-brand-blue" />
                      <span className="sr-only">{t('current')}</span>
                    </>
                  ) : null}
                </button>
              </DropdownMenuItem>
            </form>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
