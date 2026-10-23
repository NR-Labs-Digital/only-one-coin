'use server'

import { getLocale } from 'next-intl/server'
import { redirect } from '@/i18n/navigation'
import { signOutSession } from '@/lib/auth/sign-out'

/**
 * Signs the staff session out — see `signOutSession` (Better Auth's own
 * sign-out plus the cookie) — and goes back to the backoffice login.
 */
export async function logoutStaff() {
  await signOutSession()
  const locale = await getLocale()
  redirect({ href: '/backoffice', locale })
}
