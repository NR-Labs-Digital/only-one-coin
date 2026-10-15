import { apiFetch } from './api-client'
import type { OwnMfa } from './mfa'

/**
 * When the signed-in account's password last changed — null while it is
 * still the one the account was created with. A failed read degrades to
 * that same null: the line is informative, never worth breaking the page for.
 */
export async function getPasswordChangedAt(): Promise<string | null> {
  const response = await apiFetch('/api/v1/me/password')
  if (!response.ok) return null
  const body = (await response.json()) as { changedAt: string | null }
  return body.changedAt
}

/**
 * The signed-in account's second factor (OOC-29). Null when the read fails —
 * the account card then says it could not load, rather than showing "off" for
 * an account that may well have it on.
 */
export async function getOwnMfaState(): Promise<OwnMfa | null> {
  const response = await apiFetch('/api/v1/me/mfa')
  if (!response.ok) return null
  return (await response.json()) as OwnMfa
}
