/**
 * The staff second factor (OOC-29) from the browser — an e-mailed code. Two
 * halves, two backends:
 *
 * - The sign-in challenge talks to Better Auth's own `/api/auth/two-factor/*`
 *   through the same-origin proxy: after a correct password Better Auth
 *   withholds the session and sets a short-lived challenge cookie, and these
 *   endpoints are what trade a code for the session.
 * - Turning the factor on, re-issuing recovery codes and turning it off talk
 *   to apps/api's `/api/v1/me/mfa` routes, where the cargo rule lives
 *   (master, admin and billing cannot turn it off — CLAUDE.md §8).
 *
 * Every function answers a discriminated result, never throws: the screens
 * turn the error kind into copy from the locale files (CLAUDE.md §4).
 */

/** Locale header Better Auth's send-otp reads (apps/api, `LOCALE_HEADER`). */
const LOCALE_HEADER = 'x-ooc-locale'

/** The app routes on short codes; apps/api and the e-mails speak the full names. */
export const EMAIL_LOCALE: Record<string, 'es-PE' | 'pt-BR' | 'en'> = {
  es: 'es-PE',
  pt: 'pt-BR',
  en: 'en',
}

export interface OwnMfa {
  enabled: boolean
  /** The cargo cannot turn it off — and cannot use the panel until it is on. */
  required: boolean
  recoveryCodesLeft: number
}

export type MfaCodeError =
  /** Wrong code — type it again. */
  | 'invalid'
  /** Expired, or burned by too many misses — ask for a new one. */
  | 'expired'
  /** Too many failures on the account; it unlocks by itself after a while. */
  | 'locked'
  /** The sign-in challenge itself ran out (10 minutes) — start over with the password. */
  | 'challenge_expired'
  | 'failed'

export type MfaResult<T = void> = { ok: true; value: T } | { ok: false; error: MfaCodeError }

/** Better Auth's codes arrive as `auth.<code>` (AuthCatchAllRoute.ts); ours as `staff_mfa.*`. */
const REASON_TO_ERROR: Record<string, MfaCodeError> = {
  'auth.invalid_code': 'invalid',
  'auth.invalid_backup_code': 'invalid',
  'auth.otp_has_expired': 'expired',
  'auth.too_many_attempts_request_new_code': 'expired',
  'auth.account_temporarily_locked': 'locked',
  'auth.invalid_two_factor_cookie': 'challenge_expired',
  'staff_mfa.code_invalid': 'invalid',
  'staff_mfa.code_expired': 'expired',
  'staff_mfa.code_attempts_exhausted': 'expired',
}

async function post(url: string, body: unknown, locale?: string): Promise<Response | null> {
  try {
    return await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(locale && { [LOCALE_HEADER]: EMAIL_LOCALE[locale] ?? 'es-PE' }),
      },
      body: JSON.stringify(body ?? {}),
    })
  } catch {
    return null
  }
}

async function toResult<T>(response: Response | null, read: (response: Response) => Promise<T>): Promise<MfaResult<T>> {
  if (!response) return { ok: false, error: 'failed' }
  if (response.ok) return { ok: true, value: await read(response) }
  const body = (await response.json().catch(() => null)) as { reason?: string } | null
  return { ok: false, error: REASON_TO_ERROR[body?.reason ?? ''] ?? 'failed' }
}

const nothing = async () => undefined

// --- Sign-in challenge (Better Auth) -------------------------------------

/** E-mails the sign-in code. Asking again replaces the code. */
export async function sendSignInCode(locale: string): Promise<MfaResult> {
  return toResult(await post('/api/auth/two-factor/send-otp', {}, locale), nothing)
}

/** Trades the e-mailed code for the session. */
export async function verifySignInCode(code: string): Promise<MfaResult> {
  return toResult(await post('/api/auth/two-factor/verify-otp', { code }), nothing)
}

/** Trades a recovery code for the session — and spends it. */
export async function verifyRecoveryCode(code: string): Promise<MfaResult> {
  return toResult(await post('/api/auth/two-factor/verify-backup-code', { code }), nothing)
}

// --- The account's own factor (apps/api) ---------------------------------

export async function getOwnMfa(): Promise<OwnMfa | null> {
  try {
    const response = await fetch('/api/v1/me/mfa')
    return response.ok ? ((await response.json()) as OwnMfa) : null
  } catch {
    return null
  }
}

/** E-mails the code that turns the factor on. */
export async function startEnrollment(locale: string): Promise<MfaResult> {
  return toResult(await post('/api/v1/me/mfa/enrollment', { locale: EMAIL_LOCALE[locale] ?? 'es-PE' }), nothing)
}

/** Turns the factor on; answers the recovery codes — the only time they are shown. */
export async function confirmEnrollment(code: string): Promise<MfaResult<string[]>> {
  return toResult(await post('/api/v1/me/mfa/enrollment/confirm', { code }), async (response) => {
    const body = (await response.json()) as { recoveryCodes: string[] }
    return body.recoveryCodes
  })
}

export type PasswordGatedError = 'password_incorrect' | 'failed'
export type PasswordGatedResult<T = void> = { ok: true; value: T } | { ok: false; error: PasswordGatedError }

async function passwordGated<T>(
  url: string,
  password: string,
  read: (response: Response) => Promise<T>,
): Promise<PasswordGatedResult<T>> {
  const response = await post(url, { password })
  if (!response) return { ok: false, error: 'failed' }
  if (response.ok) return { ok: true, value: await read(response) }
  const body = (await response.json().catch(() => null)) as { reason?: string } | null
  return { ok: false, error: body?.reason === 'staff_password.current_incorrect' ? 'password_incorrect' : 'failed' }
}

export async function regenerateRecoveryCodes(password: string): Promise<PasswordGatedResult<string[]>> {
  return passwordGated('/api/v1/me/mfa/recovery-codes', password, async (response) => {
    const body = (await response.json()) as { recoveryCodes: string[] }
    return body.recoveryCodes
  })
}

export async function disableMfa(password: string): Promise<PasswordGatedResult> {
  return passwordGated('/api/v1/me/mfa/disable', password, nothing)
}
