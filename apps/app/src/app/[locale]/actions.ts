'use server'

import { cookies } from 'next/headers'
import { getLocale } from 'next-intl/server'
import { redirect } from '@/i18n/navigation'
import { signOutSession } from '@/lib/auth/sign-out'
import { PORTAL_PROFILE_COOKIE } from '@/lib/portal/profile-cookie'

// Ends the portal session for real (Better Auth's sign-out + the cookie) and
// goes back to the login, keeping the locale. The chosen profile (OOC-147)
// goes with the session: on a shared computer the next account starts on its
// own default.
export async function logout() {
  await signOutSession()
  ;(await cookies()).delete(PORTAL_PROFILE_COOKIE)
  const locale = await getLocale()
  redirect({ href: '/login', locale })
}
