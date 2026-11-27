import { apiFetch } from './api-client'
import type { EmailTemplate } from './types'
import type { EmailTemplateView } from './email-template-text'

/**
 * One editable e-mail, read on the server. Null when the API failed — the page
 * shows an error, never an empty editor that would overwrite the real words on
 * the first save.
 */
export async function getEmailTemplate(template: EmailTemplate): Promise<EmailTemplateView | null> {
  try {
    const response = await apiFetch(`/api/v1/emails/templates/${template}`)
    if (!response.ok) return null
    return (await response.json()) as EmailTemplateView
  } catch {
    return null
  }
}
