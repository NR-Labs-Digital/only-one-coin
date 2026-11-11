import { routing } from '@/i18n/routing'

/**
 * The language an account chose on its own profile (OOC-150): the student's
 * Perfil, the panel's and the docente's Cuenta. apps/api keeps it on the
 * account (`"user"."preferredLocale"`) in the full names the e-mails speak;
 * the app routes on the short codes.
 *
 * The route locale still decides what a page speaks — a shared link opens in
 * the language of the link. The saved one is read once, right after sign-in,
 * to open the first page in it on any device.
 */

type RouteLocale = (typeof routing.locales)[number]
type ApiLocale = 'es-PE' | 'pt-BR' | 'en'

const TO_API: Record<RouteLocale, ApiLocale> = { es: 'es-PE', pt: 'pt-BR', en: 'en' }
const TO_ROUTE: Record<ApiLocale, RouteLocale> = { 'es-PE': 'es', 'pt-BR': 'pt', en: 'en' }

function routeLocaleOf(value: unknown): RouteLocale | null {
  return typeof value === 'string' && value in TO_ROUTE ? TO_ROUTE[value as ApiLocale] : null
}

/**
 * Saves the choice on the account. Never throws and never blocks the switch:
 * the route already changed, and a save that fails only means the next
 * sign-in opens in the old language. `keepalive` lets the request outlive the
 * navigation it rides along with.
 */
export async function savePreferredLocale(locale: string): Promise<boolean> {
  const value = TO_API[locale as RouteLocale]
  if (!value) return false
  try {
    const response = await fetch('/api/v1/me/locale', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ locale: value }),
      keepalive: true,
    })
    return response.ok
  } catch {
    return false
  }
}

/**
 * The saved language of the account just signed in, as a route locale — or
 * null when it never chose one, or the read failed (the sign-in then goes on
 * in the language of the login page). `who` picks the identity route: the
 * staff `/me` refuses a student, the portal's `/portal/me` refuses staff.
 */
export async function fetchPreferredLocale(who: 'staff' | 'student'): Promise<RouteLocale | null> {
  try {
    const response = await fetch(who === 'staff' ? '/api/v1/me' : '/api/v1/portal/me', { cache: 'no-store' })
    if (!response.ok) return null
    const body = (await response.json().catch(() => null)) as { preferredLocale?: unknown } | null
    return routeLocaleOf(body?.preferredLocale)
  } catch {
    return null
  }
}
