// Client-safe on purpose: the settings forms are client components, so nothing
// here may import the server-only `api-client`.

import type { PlatformSettings } from './platform-settings'

/**
 * The settings that differ between what the form started from and what it
 * holds now — the only ones worth sending, so the audit trail names only what
 * somebody actually moved.
 */
export function changedSettings<T extends Partial<PlatformSettings>>(saved: T, draft: T): Partial<PlatformSettings> {
  const changes: Partial<PlatformSettings> = {}
  for (const key of Object.keys(draft) as (keyof T & keyof PlatformSettings)[]) {
    if (draft[key] !== saved[key]) changes[key] = draft[key] as number
  }
  return changes
}

/**
 * Saves a subset of the settings in one call (`PATCH /settings`, OOC-41): all
 * of them or none, never half a form. Returns the settings as the server now
 * holds them, or null when the save did not go through.
 */
export async function saveSettings(changes: Partial<PlatformSettings>): Promise<PlatformSettings | null> {
  try {
    const response = await fetch('/api/v1/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(changes),
    })
    if (!response.ok) return null
    return (await response.json()) as PlatformSettings
  } catch {
    return null
  }
}

/**
 * A new price for the constancia (`POST /procedure-prices`, OOC-83): a new
 * version, in force from now, and requests already opened keep what they froze.
 * Returns whether it went through.
 */
export async function saveConstanciaPrice(amountCents: number): Promise<boolean> {
  try {
    const response = await fetch('/api/v1/procedure-prices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'enrollment_certificate', amountCents }),
    })
    return response.ok
  } catch {
    return false
  }
}
