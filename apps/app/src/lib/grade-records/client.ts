import type { GradeRecordFailure, GradeRecordScope } from './types'

// Client-safe: the same-origin `/api/v1` proxy, never the database (CLAUDE.md §8).

/**
 * Downloads an acta de notas (OOC-176) and saves it under the name the API
 * gives. Every download is an audited print — and the first one records the
 * acta — so it is asked for on the click, never prefetched.
 */
export async function downloadGradeRecord(
  scope: GradeRecordScope,
  registerId: string,
): Promise<{ ok: true } | { ok: false; failure: GradeRecordFailure }> {
  const path =
    scope === 'teacher'
      ? `/api/v1/teaching/grade-register-records/${encodeURIComponent(registerId)}/pdf`
      : `/api/v1/grade-register-records/${encodeURIComponent(registerId)}/pdf`
  try {
    const response = await fetch(path)
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { reason?: string } | null
      if (body?.reason === 'document_template.not_published') return { ok: false, failure: 'not_published' }
      if (body?.reason === 'grade_register_record.no_teacher') return { ok: false, failure: 'no_teacher' }
      if (response.status === 503) return { ok: false, failure: 'unavailable' }
      return { ok: false, failure: 'generic' }
    }
    const disposition = response.headers.get('content-disposition') ?? ''
    const fileName = /filename="([^"]+)"/.exec(disposition)?.[1] ?? 'acta.pdf'
    const url = URL.createObjectURL(await response.blob())
    const link = document.createElement('a')
    link.href = url
    link.download = fileName
    link.click()
    URL.revokeObjectURL(url)
    return { ok: true }
  } catch {
    return { ok: false, failure: 'generic' }
  }
}
