// Client-safe: the card imports this file, so nothing here reaches
// `next/headers` — the server read lives in `certificate-batch-server.ts`.

/**
 * The certificate batch of a module group (OOC-33), as
 * `GET /catalog/class-groups/:id/modules/:moduleId/certificates` answers it.
 * The verdict is the API's — the screen never decides who gets a document
 * (CLAUDE.md §8). Mirrors `CERTIFICATE_BLOCK_REASONS` in `packages/domain`.
 */
export const CERTIFICATE_BLOCK_REASONS = [
  'already_issued',
  'grade_pending',
  'did_not_sit',
  'grade_below_minimum',
  'earlier_module_failed',
  'exam_not_approved',
] as const
export type CertificateBlockReason = (typeof CERTIFICATE_BLOCK_REASONS)[number]

export type CertificateGrade = { score: number; didNotSit: false } | { score: null; didNotSit: true }

export interface CertificateBatchItem {
  enrollmentId: string
  studentId: string
  /** The student's name — their data, shown as is. */
  studentName: string
  lastModuleGrade: CertificateGrade | null
  /** Null = the certificate goes out. On a course with the certification exam,
   * `exam_not_approved` is what coordination clears by marking the exam. */
  blockReason: CertificateBlockReason | null
  issued: { id: string; code: string; issuedAt: string } | null
}

export interface CertificateBatch {
  closesTheCourse: boolean
  examRequired: boolean
  templatePublished: boolean
  items: CertificateBatchItem[]
}

/** Why a confirmation did not go through, as something the card can say. */
export type CertificateIssueFailure = 'nothing_to_issue' | 'not_published' | 'missing_value' | 'failed'

const FAILURES: Record<string, CertificateIssueFailure> = {
  'certificate.nothing_to_issue': 'nothing_to_issue',
  'document_template.not_published': 'not_published',
  'document_template.missing_value': 'missing_value',
}

/**
 * Confirms the batch (client-safe: the same-origin proxy). The API runs the
 * rule again and issues only what still qualifies.
 */
export async function issueCertificateBatch(params: {
  classGroupId: string
  moduleId: string
  enrollmentIds: string[]
  examApprovedEnrollmentIds: string[]
}): Promise<{ ok: true; issued: number } | { ok: false; failure: CertificateIssueFailure }> {
  try {
    const response = await fetch(
      `/api/v1/catalog/class-groups/${encodeURIComponent(params.classGroupId)}/modules/${encodeURIComponent(params.moduleId)}/certificates`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enrollmentIds: params.enrollmentIds,
          examApprovedEnrollmentIds: params.examApprovedEnrollmentIds,
        }),
      },
    )
    if (response.ok) return { ok: true, issued: ((await response.json()) as { issued: number }).issued }
    const body = (await response.json().catch(() => null)) as { reason?: string } | null
    return { ok: false, failure: FAILURES[body?.reason ?? ''] ?? 'failed' }
  } catch {
    return { ok: false, failure: 'failed' }
  }
}

/**
 * Whether a module group closes its course — the only one a batch is
 * confirmed on. Mirrors `closesTheCourse` in `packages/domain`; the API
 * answers it too (`closesTheCourse` in the batch).
 */
export function runClosesTheCourse(run: { module: number | null; fullCourse: boolean }, courseModules: number): boolean {
  if (run.fullCourse) return false
  if (run.module === null) return courseModules <= 1
  return run.module === Math.max(1, courseModules)
}
