'use server'

import { revalidatePath } from 'next/cache'
import { apiFetch } from '@/lib/backoffice/api-client'
import { cleanProfileId } from '@/lib/portal/profile-cookie'

export type GuardianConsentActionState =
  | { status: 'idle' }
  | { status: 'accepted' }
  /** `outdated`: the text changed while the page was open; reloading shows the one in force. */
  | { status: 'error'; error: 'outdated' | 'generic' }

/**
 * The guardian accepts the consent text for one child (OOC-72). Goes through
 * `apiFetch`, which carries the guardian's IP across the hop
 * (`lib/api-identity.ts`) — the IP the consent is stamped with (Ley 29733).
 * Whether this account may accept for this profile is the API's call.
 */
export async function acceptGuardianConsent(
  _previous: GuardianConsentActionState,
  formData: FormData,
): Promise<GuardianConsentActionState> {
  const profileId = cleanProfileId(formData.get('profileId')?.toString())
  const version = formData.get('version')?.toString() ?? ''
  if (!profileId || !version || formData.get('accepted') !== 'on') return { status: 'error', error: 'generic' }

  const response = await apiFetch('/api/v1/portal/guardian-consents', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ profileId, version }),
  }).catch(() => null)
  if (!response?.ok) {
    const body = (await response?.json().catch(() => null)) as { reason?: string } | null
    return { status: 'error', error: body?.reason === 'guardian_consent.outdated_version' ? 'outdated' : 'generic' }
  }

  revalidatePath('/[locale]/portal', 'layout')
  return { status: 'accepted' }
}
