'use server'

import { revalidatePath } from 'next/cache'
import { apiFetch } from '@/lib/backoffice/api-client'
import { cleanProfileId } from '@/lib/portal/profile-cookie'

export type OwnPhoneError = 'required' | 'phone_format' | 'too_long' | 'generic'

export type OwnPhoneActionState =
  | { status: 'idle' }
  | { status: 'saved'; phone: string }
  | { status: 'error'; error: OwnPhoneError }

const FIELD_CODES = new Set<OwnPhoneError>(['required', 'phone_format', 'too_long'])

/**
 * The portal account corrects the phone of the profile on screen (OOC-110).
 * Whether this account reaches the profile, and whether the number holds, is
 * the API's call; this only carries the answer back as a code the screen
 * translates.
 */
export async function updateOwnPhone(
  _previous: OwnPhoneActionState,
  formData: FormData,
): Promise<OwnPhoneActionState> {
  const profileId = cleanProfileId(formData.get('profileId')?.toString())
  const phone = formData.get('phone')?.toString() ?? ''
  if (!profileId) return { status: 'error', error: 'generic' }

  const response = await apiFetch('/api/v1/portal/me/phone', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ profileId, phone }),
  }).catch(() => null)

  if (!response?.ok) {
    const body = (await response?.json().catch(() => null)) as { fields?: { code?: string }[] } | null
    const code = body?.fields?.[0]?.code as OwnPhoneError | undefined
    return { status: 'error', error: code && FIELD_CODES.has(code) ? code : 'generic' }
  }

  const saved = (await response.json().catch(() => null)) as { phone?: string } | null
  revalidatePath('/[locale]/portal', 'layout')
  return { status: 'saved', phone: saved?.phone ?? phone }
}
