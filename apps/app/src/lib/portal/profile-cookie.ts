/**
 * Which profile the portal is showing (OOC-147) — a guardian's account has one
 * per child. Client-safe on purpose: the attachment calls run in the browser
 * and name the profile too.
 *
 * Not a secret and not an authorization: the API only ever picks among the
 * session account's own profiles, and answers anything else as the default
 * one (apps/api, `pickProfile`). So the cookie is readable by the page
 * (no `httpOnly`) and carries only a file id.
 */
export const PORTAL_PROFILE_COOKIE = 'ooc_portal_profile'

/** A year: the choice outlives the session, like the language does. */
export const PORTAL_PROFILE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Only a well-formed id ever leaves the app — anything else is no choice. */
export function cleanProfileId(value: string | null | undefined): string | null {
  return value && UUID.test(value) ? value : null
}

/** `path` with `profile=<id>` added, or untouched when there is no choice. */
export function pathWithProfile(path: string, profileId: string | null): string {
  if (!profileId) return path
  return `${path}${path.includes('?') ? '&' : '?'}profile=${encodeURIComponent(profileId)}`
}

/** The choice as the browser holds it (`document.cookie`). */
export function profileFromCookieString(cookieString: string): string | null {
  const entry = cookieString
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${PORTAL_PROFILE_COOKIE}=`))
  return cleanProfileId(entry ? decodeURIComponent(entry.slice(PORTAL_PROFILE_COOKIE.length + 1)) : null)
}
