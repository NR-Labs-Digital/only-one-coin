'use server'

import { cookies } from 'next/headers'
import { getLocale } from 'next-intl/server'
import { redirect } from '@/i18n/navigation'
import { cleanProfileId, PORTAL_PROFILE_COOKIE, PORTAL_PROFILE_COOKIE_MAX_AGE } from '@/lib/portal/profile-cookie'

/**
 * Switches the profile the portal shows (OOC-147) and lands on the portal's
 * home: the page that was open may be about the other child (an enrollment,
 * a payment). Only the choice is stored here; whether the id is one of the
 * account's own profiles is the API's call, on every read.
 */
export async function selectProfile(formData: FormData) {
  const profileId = cleanProfileId(formData.get('profileId')?.toString())
  const store = await cookies()
  if (profileId) {
    store.set(PORTAL_PROFILE_COOKIE, profileId, {
      path: '/',
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: PORTAL_PROFILE_COOKIE_MAX_AGE,
    })
  } else {
    store.delete(PORTAL_PROFILE_COOKIE)
  }
  redirect({ href: '/portal', locale: await getLocale() })
}
