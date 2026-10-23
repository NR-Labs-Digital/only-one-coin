'use client'

import { GraduationCap, LogOut, UserRound } from 'lucide-react'
import { Link } from '@/i18n/navigation'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

/**
 * The person's own chip at the bottom of the rail, folded into one dropdown:
 * the profile (their account — password, second factor, sessions, language)
 * and the way out. One control instead of a chip plus a loose logout row —
 * the rail lists the institution's modules, and what belongs to the reader
 * stays behind the reader's own face.
 *
 * Client component only because the menu opens on the client; signing out
 * stays the server action the old button already submitted.
 */
export function BoUserMenu({
  name,
  roleLabel,
  monogram,
  profileLabel,
  teacherFile,
  accountHref = '/backoffice/account',
  logoutLabel,
  logout,
}: {
  name: string
  roleLabel: string
  monogram: string
  profileLabel: string
  /** The teacher's own ficha on the roster — only a teacher session has one. */
  teacherFile: { href: string; label: string } | null
  /** The reader's account page — each portal has its own. */
  accountHref?: '/backoffice/account' | '/docente/account'
  logoutLabel: string
  logout: () => Promise<void>
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        title={name}
        className="flex w-full items-center gap-2.5 rounded-lg px-1 py-1 text-left transition hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0"
      >
        <Avatar className="size-8 shrink-0">
          <AvatarFallback className="bg-white/10 text-xs font-semibold text-white">
            {monogram}
          </AvatarFallback>
        </Avatar>
        <span className="flex min-w-0 flex-col leading-tight group-data-[collapsible=icon]:hidden">
          <span className="truncate text-[15px] font-semibold text-white">
            {name}
          </span>
          <span className="truncate text-xs text-slate-400">{roleLabel}</span>
        </span>
      </DropdownMenuTrigger>

      <DropdownMenuContent side="top" align="start" className="w-52">
        <DropdownMenuItem asChild>
          <Link href={accountHref} className="flex items-center gap-2">
            <UserRound className="size-4" />
            {profileLabel}
          </Link>
        </DropdownMenuItem>
        {teacherFile && (
          <DropdownMenuItem asChild>
            <Link href={teacherFile.href} className="flex items-center gap-2">
              <GraduationCap className="size-4" />
              {teacherFile.label}
            </Link>
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        {/* The item submits the same server action the old footer button did —
            Radix closes the menu on select, and the form carries the POST. */}
        <form action={logout}>
          <DropdownMenuItem asChild>
            <button
              type="submit"
              className="flex w-full items-center gap-2 text-red-600 focus:text-red-600"
            >
              <LogOut className="size-4" />
              {logoutLabel}
            </button>
          </DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
