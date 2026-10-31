import { apiFetch } from './api-client'
import type { EmailDeliveryIssues, EmailTemplate } from './types'

/**
 * The e-mails about a student that failed and nobody resent yet (OOC-90),
 * newest first, optionally one template's. `null` means the API failed — the
 * screen says so instead of claiming everything arrived.
 */
export async function getEmailDeliveryIssues(template?: EmailTemplate): Promise<EmailDeliveryIssues | null> {
  const search = template ? `?${new URLSearchParams({ template }).toString()}` : ''
  try {
    const response = await apiFetch(`/api/v1/emails/deliveries${search}`)
    if (!response.ok) return null
    return response.json()
  } catch {
    return null
  }
}
