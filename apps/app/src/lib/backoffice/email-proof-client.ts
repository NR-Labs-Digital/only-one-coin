import type { EmailLocale } from '@/lib/backoffice/types'

export type SendEmailProofResult =
  | { ok: true; sent: number }
  | { ok: false; error: 'rate_limited' | 'generic' }

/**
 * Sends a proof of an automatic e-mail (OOC-89): the words in force (or the
 * saved draft's, OOC-60) over
 * the preview's sample data, subject marked, to the addresses on the screen.
 * The API writes it to the outbox, so outside production the allowlist
 * decides who actually receives it (CLAUDE.md §6).
 */
export async function sendEmailProof(
  template: string,
  locale: EmailLocale,
  recipients: string[],
  /** `draft`: the editor's saved draft instead of the words in force (OOC-60). */
  options: { draft?: boolean } = {},
): Promise<SendEmailProofResult> {
  try {
    const response = await fetch(`/api/v1/emails/flows/${encodeURIComponent(template)}/proof`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ locale, recipients, ...(options.draft ? { draft: true } : {}) }),
    })
    if (response.ok) {
      const body = (await response.json()) as { sent: number }
      return { ok: true, sent: body.sent }
    }
    if (response.status === 429) return { ok: false, error: 'rate_limited' }
    return { ok: false, error: 'generic' }
  } catch {
    return { ok: false, error: 'generic' }
  }
}
