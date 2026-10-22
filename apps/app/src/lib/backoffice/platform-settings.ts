import { apiFetch } from './api-client'

/**
 * Every number the platform runs on that the backoffice may change without a
 * deploy (OOC-41) — what `GET /settings` returns. Every screen that applies
 * one of these rules reads it from here, never from a constant in the code.
 */
export interface PlatformSettings {
  /** Minutes the public checkout holds a seat while the person goes off to pay. */
  checkoutHoldMinutes: number
  /** How far ABOVE the frozen price a receipt may land and still be green — never below (CLAUDE.md §1). */
  receiptAmountToleranceCents: number
  /** Below this percentage of the frozen price, rejection is suggested to the reviewer. */
  receiptRejectBelowPercent: number
  /** Days from receipt to decision: what the checkout promises and what Payments works to. */
  reviewWindowDays: number
  /** Below this confidence (whole percent) a field the OCR read is flagged to the reviewer. */
  ocrLowConfidencePercent: number
  /** Minimum final grade on the 0–20 scale (`docs/REGRAS-NEGOCIO.md` §3). */
  passingGrade: number
  /** Business days to issue the free certificate after a class group ends. */
  certificateDeadlineBusinessDays: number
  /** Today's fee for the constancia de matrícula, in cents — a paid procedure. */
  constanciaFeeCents: number
  /** How early a teacher's contract starts showing as expiring. */
  contractAlertDays: number
}

/**
 * The settings `apps/api` enforces, read on the server. Null when the API
 * cannot be reached or refuses the session — a screen then says it could not
 * load rather than inventing a value that looks real.
 */
export async function getPlatformSettings(): Promise<PlatformSettings | null> {
  try {
    const response = await apiFetch('/api/v1/settings')
    if (!response.ok) return null
    return (await response.json()) as PlatformSettings
  } catch {
    return null
  }
}
