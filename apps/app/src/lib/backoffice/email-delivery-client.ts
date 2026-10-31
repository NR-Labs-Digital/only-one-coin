export type ResendEmailResult =
  | { ok: true }
  | { ok: false; error: 'already_resent' | 'not_resendable' | 'generic' }

/**
 * Resends one failed e-mail (OOC-90): a new outbox row and an audit entry,
 * written together by the API. A row somebody resent first, or one that is
 * no longer failed, comes back as `already_resent` — the list was stale.
 */
export async function resendEmailDelivery(outboxId: string): Promise<ResendEmailResult> {
  try {
    const response = await fetch(`/api/v1/emails/deliveries/${encodeURIComponent(outboxId)}/resend`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    if (response.ok) return { ok: true }
    const body = (await response.json().catch(() => null)) as { reason?: string } | null
    if (body?.reason === 'email_delivery.already_resent' || body?.reason === 'email_delivery.not_failed') {
      return { ok: false, error: 'already_resent' }
    }
    if (body?.reason === 'email_delivery.not_resendable') return { ok: false, error: 'not_resendable' }
    return { ok: false, error: 'generic' }
  } catch {
    return { ok: false, error: 'generic' }
  }
}
