export type IssuePortalAccessOutcome =
  | 'created'
  | 'linked_existing'
  | 'already_linked'
  | 'email_conflict'
  | 'activation_resent'
  | 'reset_sent'

/** What the button did for the guardian (OOC-72); null when nothing. */
export type IssueGuardianAccessOutcome = 'created' | 'linked' | 'activation_resent' | 'active' | 'conflict'

export type IssuePortalAccessResult =
  | { ok: true; outcome: IssuePortalAccessOutcome; guardian: IssueGuardianAccessOutcome | null }
  | { ok: false; error: 'no_confirmed_enrollment' | 'generic' }

/** Sends (or re-sends) a student's portal access; the API decides which. */
export async function issuePortalAccess(studentId: string): Promise<IssuePortalAccessResult> {
  try {
    const response = await fetch(`/api/v1/students/${encodeURIComponent(studentId)}/portal-access`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    if (response.ok) {
      const body = (await response.json()) as { outcome: IssuePortalAccessOutcome; guardian?: IssueGuardianAccessOutcome | null }
      // An API from before OOC-72 says nothing about the guardian.
      return { ok: true, outcome: body.outcome, guardian: body.guardian ?? null }
    }
    const body = (await response.json().catch(() => null)) as { reason?: string } | null
    return {
      ok: false,
      error: body?.reason === 'portal_access.no_confirmed_enrollment' ? 'no_confirmed_enrollment' : 'generic',
    }
  } catch {
    return { ok: false, error: 'generic' }
  }
}
