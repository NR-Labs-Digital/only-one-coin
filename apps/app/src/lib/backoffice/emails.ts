import { EMAIL_CATALOG_KEYS } from '@ooc/domain/email-catalog'
import { apiFetch } from './api-client'
import type {
  EmailFlow,
  EmailFlowCatalog,
  EmailLocale,
  EmailPreview,
  EmailTemplate,
} from './types'

/** The three languages every e-mail is written in, es-PE first (CLAUDE.md §4). */
export const EMAIL_LOCALES: EmailLocale[] = ['es-PE', 'pt-BR', 'en']

/** The API calls the catalog id `key`; the screens call it `template`. */
type EmailFlowPayload = Omit<EmailFlow, 'template'> & { key: EmailTemplate }

function toFlow({ key, ...rest }: EmailFlowPayload): EmailFlow {
  return { template: key, ...rest }
}

export function isEmailTemplate(value: string): value is EmailTemplate {
  return (EMAIL_CATALOG_KEYS as string[]).includes(value)
}

/** `GET /api/v1/emails/flows` — the whole catalog with its counts. `null` = the API failed or refused. */
export async function listEmailFlows(): Promise<EmailFlowCatalog | null> {
  try {
    const response = await apiFetch('/api/v1/emails/flows')
    if (!response.ok) return null
    const body = (await response.json()) as { windowDays: number; items: EmailFlowPayload[] }
    return { windowDays: body.windowDays, flows: body.items.map(toFlow) }
  } catch {
    return null
  }
}

/** `GET /api/v1/emails/flows/:key`. `null` = the API failed or refused. */
export async function getEmailFlow(
  template: EmailTemplate,
): Promise<{ windowDays: number; flow: EmailFlow } | null> {
  try {
    const response = await apiFetch(`/api/v1/emails/flows/${template}`)
    if (!response.ok) return null
    const body = (await response.json()) as { windowDays: number; flow: EmailFlowPayload }
    return { windowDays: body.windowDays, flow: toFlow(body.flow) }
  } catch {
    return null
  }
}

/**
 * The template in all three languages, rendered by the API (OOC-88) — the
 * reader compares the versions side by side instead of switching the whole
 * panel's language to read one. Fetched together; one failing fails the set,
 * so the screen never shows two languages and an error where the third was.
 */
export async function getEmailPreviews(
  template: EmailTemplate,
): Promise<EmailPreview[] | null> {
  try {
    const responses = await Promise.all(
      EMAIL_LOCALES.map((locale) =>
        apiFetch(`/api/v1/emails/flows/${template}/preview?locale=${locale}`),
      ),
    )
    if (responses.some((response) => !response.ok)) return null
    return (await Promise.all(responses.map((response) => response.json()))) as EmailPreview[]
  } catch {
    return null
  }
}
