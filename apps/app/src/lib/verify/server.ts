import { serverEnv } from '@/server-env'
import { requestIdentityHeaders } from '@/lib/api-identity'

/**
 * What the public validation page shows about a code (OOC-59), as
 * `GET /api/v1/public/issued-documents/:code` answers it. Public fields only:
 * never a document number, an e-mail, a grade or a guardian.
 */
export interface VerifiedDocument {
  kind: 'enrollment_certificate' | 'certificate'
  status: 'valid' | 'revoked' | 'replaced'
  studentName: string
  courseName: string
  /** Calendar days, `YYYY-MM-DD`; null when the document printed none. */
  startsOn: string | null
  endsOn: string | null
  issuedAt: string
  revokedAt: string | null
}

export type VerifyOutcome =
  | { kind: 'found'; document: VerifiedDocument }
  /** A code nobody issued and a code that cannot be one read alike. */
  | { kind: 'not_found' }
  | { kind: 'too_many' }
  | { kind: 'error' }

/**
 * Public, no session: called straight against `apps/api` from the server, like
 * the checkout catalog, with the reader's IP so the per-IP ceiling counts the
 * reader and not Vercel.
 */
export async function verifyDocumentCode(code: string): Promise<VerifyOutcome> {
  try {
    const response = await fetch(
      new URL(`/api/v1/public/issued-documents/${encodeURIComponent(code)}`, serverEnv.API_INTERNAL_URL),
      { headers: await requestIdentityHeaders(), cache: 'no-store' },
    )
    if (response.status === 404 || response.status === 400) return { kind: 'not_found' }
    if (response.status === 429) return { kind: 'too_many' }
    if (!response.ok) return { kind: 'error' }
    return { kind: 'found', document: (await response.json()) as VerifiedDocument }
  } catch {
    return { kind: 'error' }
  }
}
