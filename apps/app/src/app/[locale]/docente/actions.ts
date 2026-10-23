'use server'

import { getLocale } from 'next-intl/server'
import { redirect } from '@/i18n/navigation'
import { signOutSession } from '@/lib/auth/sign-out'

/**
 * Signs the teacher out — the same `signOutSession` as the backoffice's
 * `logoutStaff` — and lands back on the docente portal's own login.
 */
export async function logoutTeacher() {
  await signOutSession()
  const locale = await getLocale()
  redirect({ href: '/docente', locale })
}
